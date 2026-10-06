// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { sha256Base64Url } from '../util/ids.js';

// Google OAuth 2.0 for installed (Desktop) apps: loopback redirect + PKCE.
// Endpoints per https://accounts.google.com/.well-known/openid-configuration.

export const GOOGLE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
} as const;

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
/** Minimum scopes: identity (sub, email) + read-only Gmail. Nothing broader. */
export const REQUESTED_SCOPES = ['openid', 'email', GMAIL_READONLY_SCOPE] as const;

export type FetchFn = typeof fetch;

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export function pkceChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}

export function buildAuthorizationUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  nonce: string;
  loginHint?: string;
}): string {
  const url = new URL(GOOGLE.authorize);
  const params: Record<string, string> = {
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: REQUESTED_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    state: p.state,
    nonce: p.nonce,
    code_challenge: pkceChallenge(p.codeVerifier),
    code_challenge_method: 'S256',
  };
  if (p.loginHint) params.login_hint = p.loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

async function postForm(fetchFn: FetchFn, url: string, body: Record<string, string>): Promise<Response> {
  return fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  });
}

async function readTokenResponse(res: Response): Promise<TokenResponse> {
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  if (!res.ok) {
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    // error_description is Google-authored text; it never contains our secrets.
    const desc = typeof json.error_description === 'string' ? json.error_description : 'Token request failed';
    throw new OAuthError(code, desc);
  }
  if (typeof json.access_token !== 'string' || typeof json.expires_in !== 'number') {
    throw new OAuthError('invalid_response', 'Token response is missing access_token or expires_in');
  }
  return json as unknown as TokenResponse;
}

export async function exchangeCode(
  fetchFn: FetchFn,
  client: GoogleClient,
  p: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const res = await postForm(fetchFn, GOOGLE.token, {
    grant_type: 'authorization_code',
    code: p.code,
    code_verifier: p.codeVerifier,
    redirect_uri: p.redirectUri,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  return readTokenResponse(res);
}

export async function refreshAccessToken(
  fetchFn: FetchFn,
  client: GoogleClient,
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await postForm(fetchFn, GOOGLE.token, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  return readTokenResponse(res);
}

/** Best effort. Returns true if Google confirmed revocation. */
export async function revokeToken(fetchFn: FetchFn, token: string): Promise<boolean> {
  try {
    const res = await postForm(fetchFn, GOOGLE.revoke, { token });
    return res.ok;
  } catch {
    return false;
  }
}

export interface IdTokenClaims {
  sub: string;
  email: string;
  email_verified: boolean;
}

/**
 * The ID token comes straight from Google's token endpoint over TLS, so per
 * OpenID Connect Core §3.1.3.7 TLS server validation stands in for a
 * signature check. We still validate iss, aud, exp and nonce.
 */
export function validateIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string; nowSeconds?: number },
): IdTokenClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OAuthError('invalid_id_token', 'ID token is malformed');
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new OAuthError('invalid_id_token', 'ID token payload is not JSON');
  }
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  const aud = claims.aud;
  const audOk = aud === expected.clientId || (Array.isArray(aud) && aud.includes(expected.clientId));
  if (!GOOGLE.issuers.includes(claims.iss as (typeof GOOGLE.issuers)[number])) {
    throw new OAuthError('invalid_id_token', 'ID token issuer is not Google');
  }
  if (!audOk) throw new OAuthError('invalid_id_token', 'ID token audience does not match this OAuth client');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < now) throw new OAuthError('invalid_id_token', 'ID token has expired');
  if (claims.nonce !== expected.nonce) throw new OAuthError('invalid_id_token', 'ID token nonce does not match');
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw new OAuthError('invalid_id_token', 'ID token has no subject');
  if (typeof claims.email !== 'string') throw new OAuthError('invalid_id_token', 'ID token has no email (was the email scope granted?)');
  return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified === true };
}

export function grantedScopes(token: TokenResponse): string[] {
  return (token.scope ?? '').split(/\s+/).filter(Boolean);
}
