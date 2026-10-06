// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import type { AccountRecord } from '../config/config-store.js';
import type { AccountRegistry } from '../accounts/registry.js';
import type { TokenManager } from '../accounts/token-manager.js';
import { GmailProvider } from '../providers/gmail/gmail-provider.js';
import type { EmailProvider, MessageSummary } from '../providers/types.js';
import type { FetchFn } from '../oauth/google.js';
import type { QuotaLimiter } from '../util/rate-limit.js';
import { ToolError } from './errors.js';

// Glue between tools and providers: resolves accounts, builds a provider bound
// to one account's token and quota bucket, and caches message metadata briefly
// (headers only, in memory) so paging through merged results doesn't refetch.

export interface MailServiceDeps {
  registry: AccountRegistry;
  tokens: TokenManager;
  limiter: QuotaLimiter;
  fetchFn?: FetchFn;
  gmailBaseUrl?: string;
  now?: () => number;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 1000;

export class MailService {
  private summaryCache = new Map<string, { value: MessageSummary; at: number }>();

  constructor(private readonly deps: MailServiceDeps) {}

  get now(): number {
    return (this.deps.now ?? Date.now)();
  }

  async accounts(): Promise<AccountRecord[]> {
    return this.deps.registry.list();
  }

  async requireAccount(ref: string): Promise<AccountRecord> {
    const account = await this.deps.registry.resolve(ref);
    if (!account) {
      const labels = (await this.accounts()).map((a) => `"${a.label}"`).join(', ') || 'none';
      throw new ToolError('ACCOUNT_NOT_FOUND', `No connected account matches "${ref.slice(0, 80)}". Connected accounts: ${labels}.`);
    }
    return account;
  }

  /** Accounts to search: explicit refs, or all accounts marked include_in_search_all. */
  async selectAccounts(refs: string[] | undefined): Promise<AccountRecord[]> {
    const all = await this.accounts();
    if (all.length === 0) {
      throw new ToolError('NO_ACCOUNTS_CONNECTED', 'No email accounts are connected yet.', {
        how_to_fix: 'In a terminal, run: cmec setup   (or `cmec add` if setup has already been done)',
      });
    }
    if (!refs || refs.length === 0) {
      const included = all.filter((a) => a.include_in_search_all);
      if (included.length === 0) throw new ToolError('INVALID_ARGUMENT', 'All accounts are excluded from "search all". Name the accounts to search.');
      return included;
    }
    const out: AccountRecord[] = [];
    for (const ref of refs) {
      const acc = await this.requireAccount(ref);
      if (!out.some((a) => a.id === acc.id)) out.push(acc);
    }
    return out;
  }

  provider(account: AccountRecord): EmailProvider {
    const { tokens, limiter, fetchFn, gmailBaseUrl } = this.deps;
    // The token source is bound to this account id and nothing else.
    return new GmailProvider(
      (force) => tokens.getAccessToken(account.id, force),
      fetchFn ?? fetch,
      (units) => limiter.charge(account.id, units),
      gmailBaseUrl,
    );
  }

  async summary(account: AccountRecord, provider: EmailProvider, messageId: string): Promise<MessageSummary> {
    const key = `${account.id}:${messageId}`;
    const hit = this.summaryCache.get(key);
    if (hit && this.now - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await provider.getSummary(messageId);
    this.summaryCache.set(key, { value, at: this.now });
    if (this.summaryCache.size > CACHE_MAX) {
      const oldest = this.summaryCache.keys().next().value;
      if (oldest) this.summaryCache.delete(oldest);
    }
    return value;
  }
}

/** Runs `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
