import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { allSecrets, createHarness, type Harness } from '../helpers/harness.js';
import { CLIENT, textMessage } from '../helpers/fake-google.js';
import { AccountError, AccountService } from '../../src/accounts/account-service.js';
import { NeedsReauthError, TokenManager } from '../../src/accounts/token-manager.js';
import { SECRET_KEYS } from '../../src/secrets/secret-store.js';
import { silentLogger } from '../../src/util/logger.js';
import { ACCOUNT_ID_PATTERN } from '../../src/util/ids.js';

describe('account lifecycle', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
    h.google.addMailbox({ sub: 'sub-A', email: 'personal@gmail.com', messages: [textMessage({ id: 'a1', from: 'x@example.com', to: 'personal@gmail.com', subject: 's', body: 'b', date: Date.UTC(2026, 0, 1) })] });
    h.google.addMailbox({ sub: 'sub-B', email: 'business@gmail.com', messages: [] });
    h.google.addMailbox({ sub: 'sub-C', email: 'accounting@gmail.com', messages: [] });
  });
  afterEach(async () => h.cleanup());

  it('connects three accounts with distinct opaque ids keyed by Google sub', async () => {
    const a = await h.connect('sub-A', { label: 'Personal' });
    const b = await h.connect('sub-B', { label: 'Business' });
    const c = await h.connect('sub-C');
    expect([a.created, b.created, c.created]).toEqual([true, true, true]);
    const ids = [a.account.id, b.account.id, c.account.id];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(ACCOUNT_ID_PATTERN);
    expect(c.account.label).toBe('accounting'); // default label from the address
    expect(a.account.provider_account_id).toBe('sub-A');
    expect(a.account.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(await h.secrets.get(SECRET_KEYS.refreshToken(a.account.id))).toMatch(/^1\/\//);
  });

  it('requests only the minimum scopes with PKCE S256, offline access and account chooser', async () => {
    let seen = '';
    await h.rt.accounts.connect({
      timeoutMs: 5000,
      openBrowser: async (url) => {
        seen = url;
        const { code, state } = h.google.approve(url, 'sub-A');
        const cb = new URL(new URL(url).searchParams.get('redirect_uri')!);
        cb.searchParams.set('code', code);
        cb.searchParams.set('state', state);
        await fetch(cb);
      },
    });
    const p = new URL(seen).searchParams;
    expect(p.get('scope')!.split(' ').sort()).toEqual(['email', 'https://www.googleapis.com/auth/gmail.readonly', 'openid']);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('prompt')).toBe('consent select_account');
    expect(p.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(p.get('state')!.length).toBeGreaterThanOrEqual(43);
    expect(p.get('nonce')).toBeTruthy();
    expect(p.has('include_granted_scopes')).toBe(false);
  });

  it('reconnecting the same Google account updates it in place', async () => {
    const first = await h.connect('sub-A', { label: 'Personal' });
    const oldToken = await h.secrets.get(SECRET_KEYS.refreshToken(first.account.id));
    const again = await h.connect('sub-A'); // e.g. "accounts add" by mistake
    expect(again.created).toBe(false);
    expect(again.account.id).toBe(first.account.id);
    expect(again.account.label).toBe('Personal');
    expect(await h.secrets.get(SECRET_KEYS.refreshToken(first.account.id))).not.toBe(oldToken);
    expect(await h.rt.registry.list()).toHaveLength(1);

    const re = await h.connect('sub-A', { reconnectLabel: 'Personal' });
    expect(re.account.id).toBe(first.account.id);
    expect(re.account.status).toBe('active');
  });

  it('refuses to reconnect an account as a different Google account, and revokes the stray token', async () => {
    await h.connect('sub-A', { label: 'Personal' });
    const revokedBefore = h.google.revoked.length;
    await expect(h.connect('sub-B', { reconnectLabel: 'Personal' })).rejects.toThrow(/signed in as business@gmail.com/);
    expect(h.google.revoked.length).toBe(revokedBefore + 1);
    const list = await h.rt.registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.provider_account_id).toBe('sub-A');
  });

  it('refuses an authorisation without the Gmail read scope, and one without a refresh token', async () => {
    await expect(h.connect('sub-A', { scope: 'openid email' })).rejects.toThrow(/did not grant read access/);
    await expect(h.connect('sub-A', { noRefresh: true })).rejects.toThrow(/refresh token/);
    expect(await h.rt.registry.list()).toHaveLength(0);
    expect(h.secrets.values.size).toBe(1); // only the client secret
  });

  it('enforces unique labels', async () => {
    await h.connect('sub-A', { label: 'Work' });
    await expect(h.connect('sub-B', { label: 'work' })).rejects.toBeInstanceOf(AccountError);
    const b = await h.connect('sub-B', { label: 'Business' });
    await expect(h.rt.accounts.relabel(b.account, 'WORK')).rejects.toThrow(/already used/);
    await expect(h.rt.accounts.relabel(b.account, 'acc_sneaky')).rejects.toThrow(/acc_/);
    expect((await h.rt.accounts.relabel(b.account, 'Accounts payable')).label).toBe('Accounts payable');
  });

  it('disconnect revokes at Google, deletes the stored token and removes the account', async () => {
    const a = await h.connect('sub-A', { label: 'Personal' });
    await h.connect('sub-B', { label: 'Business' });
    const token = (await h.secrets.get(SECRET_KEYS.refreshToken(a.account.id)))!;
    const res = await h.rt.accounts.disconnect(a.account);
    expect(res.revoked).toBe(true);
    expect(h.google.revoked).toContain(token);
    expect(await h.secrets.get(SECRET_KEYS.refreshToken(a.account.id))).toBeNull();
    expect((await h.rt.registry.list()).map((x) => x.label)).toEqual(['Business']);
  });

  it('removeEverything clears accounts, tokens and the client secret', async () => {
    await h.connect('sub-A');
    await h.connect('sub-B');
    const res = await h.rt.accounts.removeEverything();
    expect(res).toEqual({ accounts: 2, revoked: 2 });
    expect(h.secrets.values.size).toBe(0);
    const cfg = JSON.parse(await fs.readFile(h.rt.store.path, 'utf8'));
    expect(cfg.accounts).toEqual([]);
    expect(cfg.google).toBeUndefined();
  });

  it('never writes credentials to config.json', async () => {
    await h.connect('sub-A');
    await h.connect('sub-B');
    const raw = await fs.readFile(h.rt.store.path, 'utf8');
    for (const s of allSecrets(h)) expect(raw).not.toContain(s);
    if (process.platform !== 'win32') expect((await fs.stat(h.rt.store.path)).mode & 0o777).toBe(0o600);
  });
});

describe('token refresh', () => {
  let h: Harness;
  let accountId: string;
  beforeEach(async () => {
    h = await createHarness();
    h.google.addMailbox({ sub: 'sub-A', email: 'a@gmail.com', messages: [] });
    accountId = (await h.connect('sub-A')).account.id;
  });
  afterEach(async () => h.cleanup());

  const refreshCount = () => h.google.tokenCalls.filter((c) => c.grant_type === 'refresh_token').length;

  it('caches access tokens and shares one refresh between concurrent callers', async () => {
    const tokens = await Promise.all(Array.from({ length: 10 }, () => h.rt.tokens.getAccessToken(accountId)));
    expect(new Set(tokens).size).toBe(1);
    expect(refreshCount()).toBe(1);
    await h.rt.tokens.getAccessToken(accountId);
    expect(refreshCount()).toBe(1);
    await h.rt.tokens.getAccessToken(accountId, true);
    expect(refreshCount()).toBe(2);
  });

  it('refreshes early when the token is about to expire', async () => {
    let now = Date.now();
    const tm = new TokenManager(h.secrets, () => h.rt.accounts.googleClient(), async () => {}, silentLogger, h.google.fetch, () => now);
    await tm.getAccessToken(accountId);
    now += 3599_000 - 4 * 60_000; // within 5 minutes of expiry
    await tm.getAccessToken(accountId);
    expect(refreshCount()).toBe(2);
  });

  it('stores a rotated refresh token', async () => {
    h.google.rotateRefreshTokens = true;
    const before = await h.secrets.get(SECRET_KEYS.refreshToken(accountId));
    await h.rt.tokens.getAccessToken(accountId, true);
    const after = await h.secrets.get(SECRET_KEYS.refreshToken(accountId));
    expect(after).not.toBe(before);
    expect(after).toMatch(/^1\/\//);
  });

  it('marks the account needs_reauth on invalid_grant', async () => {
    h.google.invalidGrantFor.add((await h.secrets.get(SECRET_KEYS.refreshToken(accountId)))!);
    await expect(h.rt.tokens.getAccessToken(accountId, true)).rejects.toBeInstanceOf(NeedsReauthError);
    expect((await h.rt.registry.list())[0]!.status).toBe('needs_reauth');
    // Reconnecting fixes it.
    await h.connect('sub-A', { reconnectLabel: 'a' });
    expect((await h.rt.registry.list())[0]!.status).toBe('active');
    await expect(h.rt.tokens.getAccessToken(accountId, true)).resolves.toMatch(/^ya29\./);
  });

  it('treats a missing keychain entry as needing reconnect', async () => {
    await h.secrets.delete(SECRET_KEYS.refreshToken(accountId));
    await expect(h.rt.tokens.getAccessToken(accountId, true)).rejects.toBeInstanceOf(NeedsReauthError);
  });

  it('reports a bad OAuth client clearly', async () => {
    await h.secrets.set(SECRET_KEYS.googleClientSecret, 'GOCSPX-wrong');
    await expect(h.rt.tokens.getAccessToken(accountId, true)).rejects.toThrow(/OAuth client/);
    await h.secrets.set(SECRET_KEYS.googleClientSecret, CLIENT.clientSecret);
  });
});

describe('default labels', () => {
  it('derives a unique label from the address', () => {
    const existing = [{ label: 'john' }, { label: 'john-2' }] as never[];
    expect(AccountService.defaultLabel('john@gmail.com', existing)).toBe('john-3');
  });
});
