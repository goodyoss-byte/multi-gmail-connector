// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import type { AccountRecord, ConfigFile, ConfigStore } from '../config/config-store.js';
import {
  exchangeCode,
  type FetchFn,
  GMAIL_READONLY_SCOPE,
  type GoogleClient,
  GOOGLE,
  grantedScopes,
  OAuthError,
  buildAuthorizationUrl,
  revokeToken,
  validateIdToken,
} from '../oauth/google.js';
import { type LoopbackListener, startLoopbackListener } from '../oauth/loopback.js';
import { SECRET_KEYS, type SecretStore } from '../secrets/secret-store.js';
import { newAccountId, randomUrlSafe } from '../util/ids.js';

// State-changing account operations. Only the CLI uses this; the MCP server
// never connects, reconnects or removes accounts (ADR-0012).

export class AccountError extends Error {}

export const MAX_ACCOUNTS = 25;
const LABEL = /^[\p{L}\p{N} ._-]{1,40}$/u;

export interface ConnectOptions {
  label?: string;
  /** Reconnect this existing account; the Google account signed in must match. */
  reconnect?: AccountRecord;
  /** Opens the URL in the user's browser. Also printed so it can be copied. */
  openBrowser: (url: string) => Promise<void> | void;
  timeoutMs?: number;
  /** Test hook. */
  startListener?: (opts: { expectedState: string; timeoutMs?: number }) => Promise<LoopbackListener>;
}

export interface ConnectResult {
  account: AccountRecord;
  created: boolean;
}

export class AccountService {
  constructor(
    private readonly store: ConfigStore,
    private readonly secrets: SecretStore,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async googleClient(): Promise<GoogleClient> {
    const cfg = await this.store.load();
    const secret = await this.secrets.get(SECRET_KEYS.googleClientSecret);
    if (!cfg.google?.client_id || !secret) {
      throw new AccountError('Google OAuth client is not configured. Run `npm run setup` first.');
    }
    return { clientId: cfg.google.client_id, clientSecret: secret };
  }

  /** Stores the Desktop OAuth client: id in config.json, secret in the SecretStore. */
  async configureGoogleClient(clientId: string, clientSecret: string): Promise<void> {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new AccountError('That does not look like a Google OAuth client ID.');
    if (clientSecret.length < 8 || clientSecret.length > 512) throw new AccountError('That does not look like a Google OAuth client secret.');
    await this.secrets.set(SECRET_KEYS.googleClientSecret, clientSecret);
    await this.store.update((cfg) => {
      cfg.google = { client_id: clientId };
    });
  }

  static validateLabel(label: string, accounts: AccountRecord[], selfId?: string): string {
    const clean = label.trim();
    if (!LABEL.test(clean)) throw new AccountError('Labels are 1–40 letters, numbers, spaces, dots, dashes or underscores.');
    if (/^acc_/i.test(clean)) throw new AccountError('Labels must not start with "acc_".');
    if (accounts.some((a) => a.id !== selfId && a.label.toLowerCase() === clean.toLowerCase())) {
      throw new AccountError(`The label "${clean}" is already used by another account.`);
    }
    return clean;
  }

  async connect(opts: ConnectOptions): Promise<ConnectResult> {
    const client = await this.googleClient();
    const before = await this.store.load();
    if (!opts.reconnect && before.accounts.length >= MAX_ACCOUNTS) {
      throw new AccountError(`You can connect at most ${MAX_ACCOUNTS} accounts.`);
    }
    if (opts.label) AccountService.validateLabel(opts.label, before.accounts, opts.reconnect?.id);

    const state = randomUrlSafe(32);
    const codeVerifier = randomUrlSafe(48);
    const nonce = randomUrlSafe(24);
    const listener = await (opts.startListener ?? startLoopbackListener)({ expectedState: state, timeoutMs: opts.timeoutMs });
    try {
      const url = buildAuthorizationUrl({
        clientId: client.clientId,
        redirectUri: listener.redirectUri,
        state,
        codeVerifier,
        nonce,
        loginHint: opts.reconnect?.email,
      });
      await opts.openBrowser(url);
      const { code, iss } = await listener.result;
      if (iss !== null && !GOOGLE.issuers.includes(iss as (typeof GOOGLE.issuers)[number])) {
        throw new OAuthError('invalid_issuer', 'The sign-in response did not come from Google');
      }
      const tokens = await exchangeCode(this.fetchFn, client, { code, codeVerifier, redirectUri: listener.redirectUri });
      const scopes = grantedScopes(tokens);
      const revokeNew = async () => {
        await revokeToken(this.fetchFn, tokens.refresh_token ?? tokens.access_token);
      };
      if (!scopes.includes(GMAIL_READONLY_SCOPE)) {
        await revokeNew();
        throw new AccountError(
          'Google did not grant read access to Gmail. Connect again and, on the permission screen, click "Select all" or tick "View your email messages and settings".',
        );
      }
      if (!tokens.id_token) {
        await revokeNew();
        throw new AccountError('Google did not return an identity token.');
      }
      const identity = validateIdToken(tokens.id_token, { clientId: client.clientId, nonce });
      if (!tokens.refresh_token) {
        await revokeNew();
        throw new AccountError('Google did not return a refresh token. Remove this app at https://myaccount.google.com/permissions and connect again.');
      }

      const current = await this.store.load();
      const existing = current.accounts.find((a) => a.provider === 'google' && a.provider_account_id === identity.sub);
      if (opts.reconnect && opts.reconnect.provider_account_id !== identity.sub) {
        await revokeNew();
        throw new AccountError(
          `You signed in as ${identity.email}, but "${opts.reconnect.label}" is ${opts.reconnect.email}. Nothing was changed.`,
        );
      }

      const timestamp = this.now().toISOString();
      const target = existing ?? opts.reconnect;
      const id = target?.id ?? newAccountId();
      // Secret first, then config: a config entry never points at a missing token.
      await this.secrets.set(SECRET_KEYS.refreshToken(id), tokens.refresh_token);
      let saved!: AccountRecord;
      try {
        await this.store.update((cfg: ConfigFile) => {
          const idx = cfg.accounts.findIndex((a) => a.id === id);
          const label = opts.label
            ? AccountService.validateLabel(opts.label, cfg.accounts, id)
            : (target?.label ?? AccountService.defaultLabel(identity.email, cfg.accounts));
          const record: AccountRecord = {
            id,
            provider: 'google',
            provider_account_id: identity.sub,
            email: identity.email,
            label,
            status: 'active',
            include_in_search_all: target?.include_in_search_all ?? true,
            scopes,
            connected_at: target?.connected_at ?? timestamp,
            authorized_at: timestamp,
            updated_at: timestamp,
          };
          if (idx >= 0) cfg.accounts[idx] = record;
          else cfg.accounts.push(record);
          saved = record;
        });
      } catch (err) {
        if (!target) await this.secrets.delete(SECRET_KEYS.refreshToken(id));
        throw err;
      }
      return { account: saved, created: !target };
    } finally {
      await listener.close().catch(() => {});
    }
  }

  static defaultLabel(email: string, accounts: AccountRecord[]): string {
    const base = (email.split('@')[0] ?? 'account').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 30) || 'account';
    let label = base;
    for (let n = 2; accounts.some((a) => a.label.toLowerCase() === label.toLowerCase()); n++) label = `${base}-${n}`;
    return label;
  }

  /** Revokes at Google (best effort), deletes the keychain entry, removes from config. */
  async disconnect(account: AccountRecord): Promise<{ revoked: boolean }> {
    const key = SECRET_KEYS.refreshToken(account.id);
    const refreshToken = await this.secrets.get(key);
    const revoked = refreshToken ? await revokeToken(this.fetchFn, refreshToken) : false;
    await this.secrets.delete(key);
    await this.store.update((cfg) => {
      cfg.accounts = cfg.accounts.filter((a) => a.id !== account.id);
    });
    return { revoked };
  }

  async relabel(account: AccountRecord, label: string): Promise<AccountRecord> {
    let updated!: AccountRecord;
    await this.store.update((cfg) => {
      const acc = cfg.accounts.find((a) => a.id === account.id);
      if (!acc) throw new AccountError('Account not found.');
      acc.label = AccountService.validateLabel(label, cfg.accounts, acc.id);
      acc.updated_at = this.now().toISOString();
      updated = { ...acc };
    });
    return updated;
  }

  async setIncludeInSearchAll(account: AccountRecord, include: boolean): Promise<void> {
    await this.store.update((cfg) => {
      const acc = cfg.accounts.find((a) => a.id === account.id);
      if (!acc) throw new AccountError('Account not found.');
      acc.include_in_search_all = include;
      acc.updated_at = this.now().toISOString();
    });
  }

  /** Disconnects every account and deletes the client secret and config. */
  async removeEverything(): Promise<{ accounts: number; revoked: number }> {
    const cfg = await this.store.load();
    let revoked = 0;
    for (const acc of cfg.accounts) {
      if ((await this.disconnect(acc)).revoked) revoked++;
    }
    await this.secrets.delete(SECRET_KEYS.googleClientSecret);
    await this.store.update((c) => {
      delete c.google;
      c.accounts = [];
    });
    return { accounts: cfg.accounts.length, revoked };
  }
}
