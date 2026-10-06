import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { buildAuthorizationUrl, pkceChallenge, validateIdToken } from '../../src/oauth/google.js';
import { startLoopbackListener } from '../../src/oauth/loopback.js';
import { makeIdToken } from '../helpers/fake-google.js';

const CLIENT_ID = 'abc.apps.googleusercontent.com';

function get(url: string, host?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: host ? { host } : {} }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('authorization URL', () => {
  it('derives the PKCE S256 challenge as base64url(SHA-256(verifier)), checked against WebCrypto', async () => {
    const verifier = 'dBjftJeZ4CVP-mJ92K1FSQzWN6YDMvRy2VFMbJyO0vY';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const expected = Buffer.from(digest).toString('base64url');
    expect(pkceChallenge(verifier)).toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/); // no padding
  });

  it('adds login_hint only for reconnects', () => {
    const base = { clientId: CLIENT_ID, redirectUri: 'http://127.0.0.1:1234', state: 's', codeVerifier: 'v'.repeat(43), nonce: 'n' };
    expect(new URL(buildAuthorizationUrl(base)).searchParams.has('login_hint')).toBe(false);
    expect(new URL(buildAuthorizationUrl({ ...base, loginHint: 'a@gmail.com' })).searchParams.get('login_hint')).toBe('a@gmail.com');
  });
});

describe('ID token validation', () => {
  const now = 1_800_000_000;
  const good = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1234', email: 'a@gmail.com', email_verified: true, nonce: 'n1', exp: now + 600 };

  it('accepts a valid token', () => {
    expect(validateIdToken(makeIdToken(good), { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now })).toEqual({ sub: '1234', email: 'a@gmail.com', email_verified: true });
  });

  it.each([
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['wrong audience', { aud: 'other.apps.googleusercontent.com' }],
    ['expired', { exp: now - 3600 }],
    ['nonce mismatch', { nonce: 'other' }],
    ['missing sub', { sub: '' }],
    ['missing email', { email: undefined }],
  ])('rejects %s', (_name, patch) => {
    expect(() => validateIdToken(makeIdToken({ ...good, ...patch }), { clientId: CLIENT_ID, nonce: 'n1', nowSeconds: now })).toThrow();
  });

  it('rejects malformed tokens', () => {
    expect(() => validateIdToken('not.a', { clientId: CLIENT_ID, nonce: 'n1' })).toThrow(/malformed/);
    expect(() => validateIdToken('a.b.c', { clientId: CLIENT_ID, nonce: 'n1' })).toThrow();
  });
});

describe('loopback listener (OAuth state validation)', () => {
  it('ignores callbacks with the wrong state and accepts the right one exactly once', async () => {
    const l = await startLoopbackListener({ expectedState: 'expected-state-value', timeoutMs: 5000 });
    expect(await get(`${l.redirectUri}/?code=evil&state=wrong`)).toBe(400);
    expect(await get(`${l.redirectUri}/?code=evil`)).toBe(400);
    expect(await get(`${l.redirectUri}/other?code=x&state=expected-state-value`)).toBe(404);
    expect(await get(`${l.redirectUri}/?code=good&state=expected-state-value&iss=https%3A%2F%2Faccounts.google.com`)).toBe(200);
    await expect(l.result).resolves.toEqual({ code: 'good', iss: 'https://accounts.google.com' });
    await l.close();
  });

  it('rejects when Google reports an error for the matching state', async () => {
    const l = await startLoopbackListener({ expectedState: 'st', timeoutMs: 5000 });
    expect(await get(`${l.redirectUri}/?error=access_denied&state=st`)).toBe(400);
    await expect(l.result).rejects.toThrow(/access_denied/);
    await l.close();
  });

  it('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    const l = await startLoopbackListener({ expectedState: 'st', timeoutMs: 5000 });
    expect(await get(`${l.redirectUri}/?code=c&state=st`, 'evil.example')).toBe(400);
    await l.close();
    await expect(l.result).rejects.toThrow(/cancelled/);
  });

  it('times out', async () => {
    const l = await startLoopbackListener({ expectedState: 'st', timeoutMs: 50 });
    await expect(l.result).rejects.toThrow(/Timed out/);
    await l.close();
  });

  it('binds to 127.0.0.1 only', async () => {
    const l = await startLoopbackListener({ expectedState: 'st', timeoutMs: 5000 });
    expect(l.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await l.close();
  });
});
