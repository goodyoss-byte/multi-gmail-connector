// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { type FetchFn, type GoogleClient, OAuthError, refreshAccessToken } from '../oauth/google.js';
import { SECRET_KEYS, type SecretStore } from '../secrets/secret-store.js';
import type { Logger } from '../util/logger.js';

// Access tokens live only in this process's memory. Refresh tokens are read
// from the SecretStore on demand. Concurrent refreshes for the same account
// share one in-flight request.

export class NeedsReauthError extends Error {
  constructor(readonly accountId: string) {
    super('Account needs to be reconnected');
  }
}

export class NotConfiguredError extends Error {}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const EARLY_REFRESH_MS = 5 * 60_000;

export class TokenManager {
  private cache = new Map<string, CachedToken>();
  private inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly secrets: SecretStore,
    private readonly client: () => Promise<GoogleClient>,
    private readonly onReauthNeeded: (accountId: string) => Promise<void>,
    private readonly log: Logger,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getAccessToken(accountId: string, force = false): Promise<string> {
    const cached = this.cache.get(accountId);
    if (!force && cached && cached.expiresAt - EARLY_REFRESH_MS > this.now()) return cached.token;
    const running = this.inflight.get(accountId);
    if (running) return running;
    const p = this.refresh(accountId).finally(() => this.inflight.delete(accountId));
    this.inflight.set(accountId, p);
    return p;
  }

  forget(accountId: string): void {
    this.cache.delete(accountId);
  }

  private async refresh(accountId: string): Promise<string> {
    const refreshToken = await this.secrets.get(SECRET_KEYS.refreshToken(accountId));
    if (!refreshToken) {
      await this.onReauthNeeded(accountId);
      throw new NeedsReauthError(accountId);
    }
    const client = await this.client();
    try {
      const res = await refreshAccessToken(this.fetchFn, client, refreshToken);
      // Google normally keeps the refresh token; if it rotates, store the new one.
      if (res.refresh_token && res.refresh_token !== refreshToken) {
        await this.secrets.set(SECRET_KEYS.refreshToken(accountId), res.refresh_token);
      }
      this.cache.set(accountId, { token: res.access_token, expiresAt: this.now() + res.expires_in * 1000 });
      this.log.debug('access token refreshed', { account_id: accountId });
      return res.access_token;
    } catch (err) {
      if (err instanceof OAuthError && (err.code === 'invalid_grant' || err.code === 'unauthorized_client')) {
        this.cache.delete(accountId);
        this.log.warn('refresh token rejected; account needs reconnect', { account_id: accountId, oauth_error: err.code });
        await this.onReauthNeeded(accountId);
        throw new NeedsReauthError(accountId);
      }
      if (err instanceof OAuthError && err.code === 'invalid_client') {
        throw new NotConfiguredError('Google rejected the OAuth client (client ID/secret). Run `npm run setup` again.');
      }
      throw err;
    }
  }
}
