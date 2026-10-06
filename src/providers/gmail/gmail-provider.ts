// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { cleanLine } from '../../content/sanitize.js';
import type { FetchFn } from '../../oauth/google.js';
import {
  type EmailProvider,
  type ListPage,
  type MessageDetail,
  type MessageSummary,
  ProviderError,
  type SearchFilters,
} from '../types.js';
import { bodyText, decodeBase64Url, decodeEntities, type GmailMessage, hasAttachmentsHint, header, parseAddressList, walkParts } from './mime.js';
import { buildGmailQuery } from './query.js';

export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_THREAD_MESSAGES = 50;
const SUMMARY_HEADERS = ['From', 'To', 'Subject', 'Date'];

/** Returns a valid access token for THIS account; `force` refreshes it. */
export type AccessTokenSource = (force?: boolean) => Promise<string>;

/** Charges the per-account quota budget before each call. */
export type QuotaCharge = (units: number) => void;

// Gmail API quota costs (units), https://developers.google.com/workspace/gmail/api/reference/quota
export const GMAIL_COST = { list: 5, get: 20, threadGet: 40, attachment: 20 } as const;

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;

function assertId(id: string, what: string) {
  if (!SAFE_ID.test(id)) throw new ProviderError('BAD_REQUEST', `Invalid ${what}`);
}

export class GmailProvider implements EmailProvider {
  readonly kind = 'google' as const;

  constructor(
    private readonly token: AccessTokenSource,
    private readonly fetchFn: FetchFn = fetch,
    private readonly charge: QuotaCharge = () => {},
    private readonly baseUrl: string = GMAIL_API,
  ) {}

  private async call<T>(path: string, params: Record<string, string | string[] | undefined>, units: number): Promise<T> {
    this.charge(units);
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    }
    let refreshed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const access = await this.token(refreshed);
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt < 2) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new ProviderError('UNAVAILABLE', 'Could not reach the Gmail API');
      }
      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new ProviderError('MALFORMED', 'Gmail returned a response that is not JSON');
        }
      }
      const reason = await errorReason(res);
      if (res.status === 401 && !refreshed) {
        refreshed = true; // one forced refresh, then retry
        continue;
      }
      if (res.status === 401) throw new ProviderError('UNAUTHORIZED', 'Gmail rejected the access token');
      if (res.status === 429 || (res.status === 403 && /rate ?limit/i.test(reason))) {
        throw new ProviderError('RATE_LIMITED', 'Gmail rate limit reached for this account', retryAfter(res) ?? 30);
      }
      if (res.status === 403) throw new ProviderError('FORBIDDEN', 'Gmail refused access (was read permission removed?)');
      if (res.status === 404) throw new ProviderError('NOT_FOUND', 'Not found in this mailbox');
      if (res.status === 400) throw new ProviderError('BAD_REQUEST', 'Gmail rejected the request (check the search syntax)');
      if (res.status >= 500 && attempt < 2) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
      throw new ProviderError('UNAVAILABLE', `Gmail is unavailable (HTTP ${res.status})`);
    }
    throw new ProviderError('UNAVAILABLE', 'Gmail request failed after retries');
  }

  async listMessageIds(filters: SearchFilters, pageSize: number, pageToken?: string): Promise<ListPage> {
    const q = buildGmailQuery(filters);
    const json = await this.call<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(
      '/messages',
      { q: q || undefined, maxResults: String(pageSize), pageToken, includeSpamTrash: 'false' },
      GMAIL_COST.list,
    );
    const ids = (json.messages ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && SAFE_ID.test(id));
    return { ids, next_page_token: typeof json.nextPageToken === 'string' ? json.nextPageToken : null };
  }

  async getSummary(messageId: string): Promise<MessageSummary> {
    assertId(messageId, 'message id');
    const msg = await this.call<GmailMessage>(
      `/messages/${messageId}`,
      { format: 'metadata', metadataHeaders: SUMMARY_HEADERS },
      GMAIL_COST.get,
    );
    return summarize(msg, messageId);
  }

  async getMessage(messageId: string): Promise<MessageDetail> {
    assertId(messageId, 'message id');
    const msg = await this.call<GmailMessage>(`/messages/${messageId}`, { format: 'full' }, GMAIL_COST.get);
    return detail(msg, messageId);
  }

  async getThread(threadId: string): Promise<MessageDetail[]> {
    assertId(threadId, 'thread id');
    const json = await this.call<{ messages?: GmailMessage[] }>(`/threads/${threadId}`, { format: 'full' }, GMAIL_COST.threadGet);
    return (json.messages ?? []).slice(-MAX_THREAD_MESSAGES).map((m) => detail(m, m.id ?? 'unknown'));
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    assertId(messageId, 'message id');
    // Attachment ids are long; allow a wider but still URL-safe charset.
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(attachmentId)) throw new ProviderError('BAD_REQUEST', 'Invalid attachment id');
    const json = await this.call<{ data?: string; size?: number }>(
      `/messages/${messageId}/attachments/${attachmentId}`,
      {},
      GMAIL_COST.attachment,
    );
    return json.data ? decodeBase64Url(json.data, MAX_ATTACHMENT_BYTES) : Buffer.alloc(0);
  }
}

function summarize(msg: GmailMessage, fallbackId: string): MessageSummary {
  const payload = msg.payload;
  const ms = Number(msg.internalDate);
  const dateMs = Number.isFinite(ms) && ms > 0 ? ms : Date.parse(header(payload, 'Date') ?? '') || 0;
  const labels = (msg.labelIds ?? []).filter((l) => typeof l === 'string').slice(0, 50);
  return {
    provider_message_id: typeof msg.id === 'string' ? msg.id : fallbackId,
    provider_thread_id: typeof msg.threadId === 'string' ? msg.threadId : null,
    from: parseAddressList(header(payload, 'From'))[0] ?? null,
    to: parseAddressList(header(payload, 'To')).slice(0, 20),
    subject: cleanLine(header(payload, 'Subject') ?? '(no subject)', 200),
    snippet: cleanLine(decodeEntities(msg.snippet ?? ''), 200),
    date: new Date(dateMs).toISOString(),
    date_ms: dateMs,
    labels,
    has_attachments: hasAttachmentsHint(payload),
    is_unread: labels.includes('UNREAD'),
  };
}

function detail(msg: GmailMessage, fallbackId: string): MessageDetail {
  const walk = walkParts(msg.payload);
  return {
    ...summarize(msg, fallbackId),
    has_attachments: walk.attachments.length > 0,
    cc: parseAddressList(header(msg.payload, 'Cc')).slice(0, 20),
    body_text: bodyText(walk),
    attachments: walk.attachments.slice(0, 50),
    authentication_results: header(msg.payload, 'Authentication-Results')?.slice(0, 500) ?? null,
  };
}

async function errorReason(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { status?: string; message?: string; errors?: Array<{ reason?: string }> } };
    return [json.error?.status, json.error?.errors?.[0]?.reason, json.error?.message].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

function retryAfter(res: Response): number | undefined {
  const v = res.headers.get('retry-after');
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(1, Math.ceil(n)), 3600) : undefined;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
