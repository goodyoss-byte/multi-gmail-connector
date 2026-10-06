import { createHash } from 'node:crypto';

// In-process fake of Google's OAuth token/revoke endpoints and the Gmail API.
// Every Gmail call is recorded with the access token that made it, so tests
// can prove which mailbox each token touched.

export interface FakeMessage {
  id: string;
  threadId: string;
  internalDate: number;
  labelIds?: string[];
  snippet?: string;
  payload?: unknown;
  attachments?: Record<string, string>; // attachmentId -> base64url data
}

export interface FakeMailbox {
  sub: string;
  email: string;
  messages: FakeMessage[];
}

export interface GmailCall {
  token: string;
  mailbox: string | null;
  path: string;
  query: URLSearchParams;
}

export const CLIENT = {
  clientId: '1234567890-testclient.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-test-client-secret-value',
};

const b64url = (s: string) => Buffer.from(s).toString('base64url');

export function makeIdToken(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'RS256', kid: 'test' }))}.${b64url(JSON.stringify(claims))}.${b64url('signature')}`;
}

export class FakeGoogle {
  mailboxes = new Map<string, FakeMailbox>(); // by sub
  accessTokens = new Map<string, string>(); // token -> sub
  refreshTokens = new Map<string, string>(); // token -> sub
  codes = new Map<string, { sub: string; challenge: string; nonce: string; redirectUri: string; scope: string; noRefresh?: boolean }>();
  revoked: string[] = [];
  gmailCalls: GmailCall[] = [];
  tokenCalls: Array<{ grant_type: string }> = [];
  /** Queue of forced Gmail responses: status codes returned before normal handling. */
  forcedGmailStatus: Array<{ status: number; body?: unknown; headers?: Record<string, string> }> = [];
  invalidGrantFor = new Set<string>(); // refresh tokens that Google now rejects
  rotateRefreshTokens = false;
  private counter = 0;

  addMailbox(mb: FakeMailbox) {
    this.mailboxes.set(mb.sub, mb);
    return mb;
  }

  /** Simulates the user approving consent in the browser; returns the code Google would redirect with. */
  approve(authUrl: string, sub: string, opts: { scope?: string; noRefresh?: boolean } = {}): { code: string; state: string } {
    const url = new URL(authUrl);
    const code = `code-${++this.counter}-${sub}`;
    this.codes.set(code, {
      sub,
      challenge: url.searchParams.get('code_challenge')!,
      nonce: url.searchParams.get('nonce')!,
      redirectUri: url.searchParams.get('redirect_uri')!,
      scope: opts.scope ?? 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly',
      noRefresh: opts.noRefresh,
    });
    return { code, state: url.searchParams.get('state')! };
  }

  issueRefreshToken(sub: string): string {
    const t = `1//0refresh-${sub}-${++this.counter}-abcdefghijk`;
    this.refreshTokens.set(t, sub);
    return t;
  }

  private issueAccessToken(sub: string): string {
    const t = `ya29.access-${sub}-${++this.counter}`;
    this.accessTokens.set(t, sub);
    return t;
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') return this.token(new URLSearchParams(String(init?.body)));
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
      const token = new URLSearchParams(String(init?.body)).get('token') ?? '';
      this.revoked.push(token);
      this.refreshTokens.delete(token);
      return json(200, {});
    }
    if (url.host === 'gmail.googleapis.com') {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      return this.gmail(url, auth.replace(/^Bearer /, ''));
    }
    return json(404, { error: 'not_found' });
  };

  private token(body: URLSearchParams): Response {
    const grant = body.get('grant_type') ?? '';
    this.tokenCalls.push({ grant_type: grant });
    if (body.get('client_id') !== CLIENT.clientId || body.get('client_secret') !== CLIENT.clientSecret) {
      return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
    }
    if (grant === 'authorization_code') {
      const c = this.codes.get(body.get('code') ?? '');
      if (!c) return json(400, { error: 'invalid_grant', error_description: 'Bad code' });
      this.codes.delete(body.get('code')!);
      const verifier = body.get('code_verifier') ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== c.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }
      if (body.get('redirect_uri') !== c.redirectUri) return json(400, { error: 'redirect_uri_mismatch' });
      const mb = this.mailboxes.get(c.sub)!;
      return json(200, {
        access_token: this.issueAccessToken(c.sub),
        expires_in: 3599,
        ...(c.noRefresh ? {} : { refresh_token: this.issueRefreshToken(c.sub) }),
        scope: c.scope,
        token_type: 'Bearer',
        id_token: makeIdToken({
          iss: 'https://accounts.google.com',
          aud: CLIENT.clientId,
          sub: c.sub,
          email: mb.email,
          email_verified: true,
          nonce: c.nonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      });
    }
    if (grant === 'refresh_token') {
      const rt = body.get('refresh_token') ?? '';
      const sub = this.refreshTokens.get(rt);
      if (!sub || this.invalidGrantFor.has(rt)) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      const extra = this.rotateRefreshTokens ? { refresh_token: this.issueRefreshToken(sub) } : {};
      return json(200, { access_token: this.issueAccessToken(sub), expires_in: 3599, ...extra });
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  private gmail(url: URL, token: string): Response {
    const sub = this.accessTokens.get(token) ?? null;
    const path = url.pathname.replace('/gmail/v1/users/me', '');
    this.gmailCalls.push({ token, mailbox: sub, path, query: url.searchParams });
    const forced = this.forcedGmailStatus.shift();
    if (forced) return json(forced.status, forced.body ?? { error: { code: forced.status } }, forced.headers);
    if (!sub) return json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
    const mb = this.mailboxes.get(sub)!;

    if (path === '/messages') {
      const q = url.searchParams.get('q') ?? '';
      const max = Number(url.searchParams.get('maxResults') ?? 100);
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const matching = [...mb.messages]
        .filter((m) => matches(m, q))
        .sort((a, b) => b.internalDate - a.internalDate);
      const page = matching.slice(start, start + max);
      const next = start + max < matching.length ? String(start + max) : undefined;
      return json(200, { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })), ...(next ? { nextPageToken: next } : {}) });
    }
    let m = /^\/messages\/([^/]+)$/.exec(path);
    if (m) {
      const msg = mb.messages.find((x) => x.id === m![1]);
      if (!msg) return json(404, { error: { code: 404, status: 'NOT_FOUND' } });
      return json(200, render(msg, url.searchParams.get('format') ?? 'full'));
    }
    m = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
    if (m) {
      const msg = mb.messages.find((x) => x.id === m![1]);
      const data = msg?.attachments?.[m[2]!];
      if (!data) return json(404, { error: { code: 404 } });
      return json(200, { data, size: Buffer.from(data, 'base64url').length });
    }
    m = /^\/threads\/([^/]+)$/.exec(path);
    if (m) {
      const msgs = mb.messages.filter((x) => x.threadId === m![1]).sort((a, b) => a.internalDate - b.internalDate);
      if (msgs.length === 0) return json(404, { error: { code: 404 } });
      return json(200, { id: m[1], messages: msgs.map((x) => render(x, 'full')) });
    }
    return json(404, { error: { code: 404 } });
  }
}

function matches(m: FakeMessage, q: string): boolean {
  const text = JSON.stringify(m).toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t && !t.includes(':'));
  return terms.every((t) => text.includes(t.replace(/"/g, '').toLowerCase()));
}

function render(m: FakeMessage, format: string) {
  const base = { id: m.id, threadId: m.threadId, labelIds: m.labelIds ?? ['INBOX'], snippet: m.snippet ?? '', internalDate: String(m.internalDate) };
  if (format === 'metadata') {
    const p = m.payload as { headers?: unknown; mimeType?: string } | undefined;
    return { ...base, payload: p ? { mimeType: p.mimeType, headers: p.headers } : undefined };
  }
  return { ...base, payload: m.payload };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// ---- message builders -------------------------------------------------------

export function textMessage(p: {
  id: string;
  threadId?: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: number;
  html?: boolean;
  labels?: string[];
  attachments?: Array<{ id: string; filename: string; mimeType: string; content: string | Buffer; size?: number }>;
  extraHeaders?: Array<{ name: string; value: string }>;
}): FakeMessage {
  const headers = [
    { name: 'From', value: p.from },
    { name: 'To', value: p.to },
    { name: 'Subject', value: p.subject },
    { name: 'Date', value: new Date(p.date).toUTCString() },
    ...(p.extraHeaders ?? []),
  ];
  const bodyPart = {
    partId: '0',
    mimeType: p.html ? 'text/html' : 'text/plain',
    headers: [{ name: 'Content-Type', value: `${p.html ? 'text/html' : 'text/plain'}; charset="UTF-8"` }],
    body: { size: Buffer.byteLength(p.body), data: Buffer.from(p.body).toString('base64url') },
  };
  const attachments: Record<string, string> = {};
  const attParts = (p.attachments ?? []).map((a, i) => {
    const buf = typeof a.content === 'string' ? Buffer.from(a.content) : a.content;
    attachments[a.id] = buf.toString('base64url');
    return { partId: String(i + 1), mimeType: a.mimeType, filename: a.filename, body: { size: a.size ?? buf.length, attachmentId: a.id } };
  });
  const payload =
    attParts.length > 0
      ? { mimeType: 'multipart/mixed', headers, parts: [bodyPart, ...attParts] }
      : { ...bodyPart, headers: [...headers, ...bodyPart.headers] };
  return {
    id: p.id,
    threadId: p.threadId ?? `t-${p.id}`,
    internalDate: p.date,
    labelIds: p.labels ?? ['INBOX'],
    snippet: p.body.replace(/<[^>]+>/g, '').slice(0, 100),
    payload,
    attachments,
  };
}
