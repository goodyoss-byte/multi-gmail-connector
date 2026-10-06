// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import type * as z from 'zod';
import type { AccountRecord } from '../config/config-store.js';
import { cleanText, htmlToText, truncate } from '../content/sanitize.js';
import { CONTENT_NOTICE, scanForInjection } from '../content/injection.js';
import { MAX_ATTACHMENT_BYTES } from '../providers/gmail/gmail-provider.js';
import type { EmailProvider, MessageDetail, MessageSummary, SearchFilters } from '../providers/types.js';
import { toToolError, ToolError } from './errors.js';
import { type MailService, mapLimit } from './mail-service.js';
import { type CursorState, decodeCursor, encodeCursor, fingerprint, makeRef, parseRef } from './refs.js';
import {
  type GetAttachmentInput,
  type GetAttachmentOutput,
  type GetEmailInput,
  type GetEmailOutput,
  type GetThreadInput,
  type GetThreadOutput,
  LIMITS,
  type ListAccountsOutput,
  type SearchInput,
  type SearchOutput,
} from './schemas.js';

type Out<T extends z.ZodType> = z.infer<T>;

export const MANAGEMENT_HELP =
  'Accounts are managed in a terminal, never from Claude: `cmec add` connects another account, `cmec fix` renews any sign-in that has expired, `cmec list` shows them, `cmec label <label> <new label>` renames one, `cmec remove <label>` disconnects one. From a cloned checkout the same commands are `npm run cmec -- <command>`.';

/** Google expires Gmail sign-ins weekly for OAuth apps left in Testing mode. */
const REAUTH_WINDOW_DAYS = 7;

const TEXT_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/x-markdown',
  'text/calendar',
  'text/tab-separated-values',
  'text/html',
  'application/json',
]);

export function isTextType(mime: string): boolean {
  return TEXT_TYPES.has(mime.toLowerCase().split(';')[0]!.trim());
}

function tag(a: AccountRecord) {
  return { account_id: a.id, account_label: a.label, email_address: a.email, provider: a.provider };
}

export async function listEmailAccounts(svc: MailService): Promise<Out<typeof ListAccountsOutput>> {
  const accounts = await svc.accounts();
  const now = svc.now;
  return {
    accounts: accounts.map((a) => {
      const signedIn = a.authorized_at ?? a.connected_at;
      const parsed = Date.parse(signedIn);
      const days = Number.isFinite(parsed) ? Math.max(0, Math.floor((now - parsed) / 86_400_000)) : null;
      return {
        ...tag(a),
        status: a.status,
        included_in_search_all: a.include_in_search_all,
        connected_at: a.connected_at,
        last_signed_in: signedIn,
        days_since_sign_in: days,
        action_needed:
          a.status === 'needs_reauth'
            ? 'This account needs a new Google sign-in. Tell the user to run `cmec fix` in a terminal; searches will keep failing until then.'
            : days !== null && days >= REAUTH_WINDOW_DAYS - 1
              ? `Last signed in ${days} days ago. Google expires sign-ins after ${REAUTH_WINDOW_DAYS} days for OAuth apps left in Testing mode, so this one may stop working; running \`cmec fix\` renews it.`
              : null,
      };
    }),
    total: accounts.length,
    how_to_manage: MANAGEMENT_HELP,
  };
}

const ACCOUNT_CONCURRENCY = 4;
const SUMMARY_PREFETCH = 5;
const MAX_ID_PAGES = 3;

interface Position {
  id: string;
  pageToken: string | undefined;
  index: number;
  pageLength: number;
  nextPage: string | null;
}

/**
 * One account's slice of a search. Message ids are paged lazily and summaries
 * are fetched in small batches only as the merge consumes them, so a merged
 * page costs roughly `max_results` Gmail reads in total rather than
 * `max_results` for every account searched. Summaries fetched as look-ahead
 * stay in the MailService cache and are reused by the next page.
 */
class AccountStream {
  private readonly provider: EmailProvider;
  private positions: Position[] = [];
  private summaries: MessageSummary[] = [];
  private emitted = 0;
  private pageToken: string | undefined;
  private offset: number;
  private pagesRead = 0;
  private noMoreIds = false;
  failure: ToolError | null = null;

  constructor(
    private readonly svc: MailService,
    readonly account: AccountRecord,
    private readonly filters: SearchFilters,
    private readonly max: number,
    state: { t?: string; o: number },
  ) {
    this.provider = svc.provider(account);
    this.pageToken = state.t;
    this.offset = state.o;
  }

  get emittedCount(): number {
    return this.emitted;
  }

  private async ensureIds(upto: number): Promise<void> {
    while (!this.noMoreIds && this.positions.length < upto && this.pagesRead < MAX_ID_PAGES) {
      const token = this.pageToken;
      const page = await this.provider.listMessageIds(this.filters, this.max, token);
      this.pagesRead++;
      const offset = this.offset;
      page.ids.slice(offset).forEach((id, i) => {
        this.positions.push({ id, pageToken: token, index: offset + i, pageLength: page.ids.length, nextPage: page.next_page_token });
      });
      if (!page.next_page_token) {
        this.noMoreIds = true;
        break;
      }
      this.pageToken = page.next_page_token;
      this.offset = 0;
    }
  }

  /** The newest message this account has not contributed yet, or null when it has no more. */
  async head(): Promise<MessageSummary | null> {
    if (this.emitted >= this.max) return null;
    if (this.summaries.length > this.emitted) return this.summaries[this.emitted]!;
    const target = Math.min(this.summaries.length + SUMMARY_PREFETCH, this.max);
    await this.ensureIds(target);
    const want = this.positions.slice(this.summaries.length, Math.min(target, this.positions.length));
    if (want.length === 0) return null;
    const fetched = await mapLimit(want, SUMMARY_PREFETCH, (position) => this.svc.summary(this.account, this.provider, position.id));
    this.summaries.push(...fetched);
    return this.summaries[this.emitted] ?? null;
  }

  advance(): void {
    this.emitted++;
  }

  /** Where the next page should resume for this account, or null when it is finished. */
  resumeState(previous: { t?: string; o: number }): { t?: string; o: number } | null {
    if (this.emitted === 0) return this.positions.length > 0 ? previous : null;
    const last = this.positions[this.emitted - 1]!;
    if (last.index + 1 < last.pageLength) return { ...(last.pageToken ? { t: last.pageToken } : {}), o: last.index + 1 };
    if (last.nextPage) return { t: last.nextPage, o: 0 };
    return null;
  }
}

export async function searchEmails(svc: MailService, input: z.infer<typeof SearchInput>): Promise<Out<typeof SearchOutput>> {
  if (input.after && input.before && input.after >= input.before) {
    throw new ToolError('INVALID_ARGUMENT', '"after" must be earlier than "before".');
  }
  const selected = await svc.selectAccounts(input.accounts);
  const filters: SearchFilters = {
    query: input.query,
    from: input.from,
    to: input.to,
    subject: input.subject,
    after: input.after,
    before: input.before,
    has_attachment: input.has_attachment,
    is_unread: input.is_unread,
    in_inbox_only: input.in_inbox_only,
  };
  const max = input.max_results;
  const fp = fingerprint({ filters, accounts: selected.map((a) => a.id).sort(), max });
  const state: CursorState = input.cursor
    ? decodeCursor(input.cursor, fp)
    : Object.fromEntries(selected.map((a) => [a.id, { o: 0 }]));
  const active = selected.filter((a) => state[a.id]);

  // Merged newest-first by always taking the newest unconsumed message across
  // accounts, so the page is globally ordered and each account only pays for
  // the messages that actually make the page.
  const streams = active.map((a) => new AccountStream(svc, a, filters, max, state[a.id]!));
  const heads = new Map<AccountStream, MessageSummary | null>();
  const advanceHead = async (stream: AccountStream): Promise<void> => {
    try {
      heads.set(stream, await stream.head());
    } catch (err) {
      stream.failure ??= toToolError(err, stream.account);
      heads.set(stream, null);
    }
  };

  await mapLimit(streams, ACCOUNT_CONCURRENCY, advanceHead);

  const merged: Array<{ account: AccountRecord; item: MessageSummary }> = [];
  while (merged.length < max) {
    let pick: AccountStream | null = null;
    let newest: MessageSummary | null = null;
    for (const stream of streams) {
      const item = heads.get(stream);
      if (!item) continue;
      if (!newest || item.date_ms > newest.date_ms) {
        pick = stream;
        newest = item;
      }
    }
    if (!pick || !newest) break;
    merged.push({ account: pick.account, item: newest });
    pick.advance();
    await advanceHead(pick);
  }

  const failures = streams.filter((s) => s.failure).map((s) => ({ account: s.account, error: s.failure! }));
  if (failures.length > 0 && failures.length === streams.length) throw failures[0]!.error;

  const nextState: CursorState = {};
  for (const stream of streams) {
    // A failed account that contributed nothing drops out; one that contributed
    // part of this page keeps its place so a retry resumes instead of skipping.
    if (stream.failure && stream.emittedCount === 0) continue;
    const resume = stream.resumeState(state[stream.account.id]!);
    if (resume) nextState[stream.account.id] = resume;
  }

  return {
    results: merged.map(({ account, item }) => ({
      ...tag(account),
      message_ref: makeRef(account.id, item.provider_message_id),
      thread_ref: item.provider_thread_id ? makeRef(account.id, item.provider_thread_id) : null,
      from: item.from,
      to: item.to,
      subject: item.subject,
      snippet: item.snippet,
      date: item.date,
      labels: item.labels,
      has_attachments: item.has_attachments,
      is_unread: item.is_unread,
      injection_warning: scanForInjection(item.subject, item.snippet).warning,
    })),
    accounts_searched: active.map(tag),
    account_errors: failures.map((f) => ({
      account_id: f.account.id,
      account_label: f.account.label,
      error_code: f.error.code,
      message: f.error.message,
      how_to_fix: f.error.extra.how_to_fix ?? null,
    })),
    next_cursor: encodeCursor(fp, nextState),
    content_notice: CONTENT_NOTICE,
  };
}

function messageFields(account: AccountRecord, m: MessageDetail, maxBody: number) {
  const body = truncate(m.body_text, maxBody);
  const scan = scanForInjection(m.subject, m.body_text);
  return {
    message_ref: makeRef(account.id, m.provider_message_id),
    thread_ref: m.provider_thread_id ? makeRef(account.id, m.provider_thread_id) : null,
    from: m.from,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    date: m.date,
    labels: m.labels,
    is_unread: m.is_unread,
    body_text: body.text,
    body_truncated: body.truncated,
    body_original_chars: body.original_chars,
    attachments: m.attachments.map((a) => ({
      ...a,
      text_extractable: isTextType(a.mime_type) && a.size_bytes <= MAX_ATTACHMENT_BYTES,
    })),
    authentication_results: m.authentication_results,
    injection_warning: scan.warning,
    injection_flags: scan.flags,
  };
}

async function accountForRef(svc: MailService, accountId: string): Promise<AccountRecord> {
  return svc.requireAccount(accountId);
}

export async function getEmail(svc: MailService, input: z.infer<typeof GetEmailInput>): Promise<Out<typeof GetEmailOutput>> {
  const { accountId, providerId } = parseRef(input.message_ref, 'message_ref');
  const account = await accountForRef(svc, accountId);
  try {
    const m = await svc.provider(account).getMessage(providerId);
    return { ...tag(account), ...messageFields(account, m, input.max_body_chars), content_notice: CONTENT_NOTICE };
  } catch (err) {
    throw toToolError(err, account);
  }
}

export async function getThread(svc: MailService, input: z.infer<typeof GetThreadInput>): Promise<Out<typeof GetThreadOutput>> {
  const { accountId, providerId } = parseRef(input.thread_ref, 'thread_ref');
  const account = await accountForRef(svc, accountId);
  try {
    const all = await svc.provider(account).getThread(providerId);
    const kept = all.slice(-input.max_messages);
    const perMessage = Math.max(200, Math.min(input.max_body_chars_per_message, Math.floor(LIMITS.threadTotalBodyChars / Math.max(1, kept.length))));
    return {
      ...tag(account),
      thread_ref: input.thread_ref,
      message_count: all.length,
      omitted_older_messages: all.length - kept.length,
      messages: kept.map((m) => messageFields(account, m, perMessage)),
      content_notice: CONTENT_NOTICE,
    };
  } catch (err) {
    throw toToolError(err, account);
  }
}

export async function getAttachment(
  svc: MailService,
  input: z.infer<typeof GetAttachmentInput>,
): Promise<Out<typeof GetAttachmentOutput>> {
  const { accountId, providerId } = parseRef(input.message_ref, 'message_ref');
  const account = await accountForRef(svc, accountId);
  try {
    const provider = svc.provider(account);
    const base = { ...tag(account), message_ref: input.message_ref, attachment_id: input.attachment_id, content_notice: CONTENT_NOTICE };
    // Check type and size from message metadata before downloading anything.
    const message = await provider.getMessage(providerId);
    const meta = message.attachments.find((a) => a.attachment_id === input.attachment_id);
    if (!meta) throw new ToolError('ATTACHMENT_NOT_FOUND', 'That attachment is not on this email.', { account_id: account.id });
    const described = { ...base, filename: meta.filename, mime_type: meta.mime_type, size_bytes: meta.size_bytes };
    if (!isTextType(meta.mime_type)) return { ...described, extraction: 'unsupported', text: null, injection_warning: null };
    if (meta.size_bytes > MAX_ATTACHMENT_BYTES) return { ...described, extraction: 'too_large', text: null, injection_warning: null };
    const data = await provider.getAttachment(providerId, input.attachment_id);
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(data);
    const text = meta.mime_type.toLowerCase().startsWith('text/html') ? htmlToText(raw) : cleanText(raw);
    const t = truncate(text, input.max_chars);
    return {
      ...described,
      extraction: t.truncated ? 'truncated' : 'full',
      text: t.text,
      injection_warning: scanForInjection(t.text).warning,
    };
  } catch (err) {
    throw toToolError(err, account);
  }
}
