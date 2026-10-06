// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 goodyoss-byte
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { constantTimeEqual } from '../util/ids.js';
import { OAuthError } from './google.js';

// One-shot loopback listener for the OAuth redirect. Binds to 127.0.0.1 on a
// random port, accepts exactly one callback carrying the expected `state`,
// then shuts down. Nothing sensitive is ever written into the HTML response.

// Google's Desktop-app examples use a bare loopback origin (http://127.0.0.1:PORT),
// so the callback is served at the root path.
export const CALLBACK_PATH = '/';

export interface LoopbackResult {
  code: string;
  iss: string | null;
}

export interface LoopbackListener {
  redirectUri: string;
  result: Promise<LoopbackResult>;
  close(): Promise<void>;
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;line-height:1.5"><h1>${title}</h1><p>${body}</p></body>`;

function send(res: ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  res.end(PAGE(title, body));
}

export async function startLoopbackListener(opts: { expectedState: string; timeoutMs?: number }): Promise<LoopbackListener> {
  let settle!: { resolve: (r: LoopbackResult) => void; reject: (e: Error) => void };
  const result = new Promise<LoopbackResult>((resolve, reject) => (settle = { resolve, reject }));
  result.catch(() => {}); // callers observe rejection via `result`; avoid unhandled-rejection crashes on close()
  let done = false;
  let port = 0;

  const finish = (fn: () => void) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    fn();
    setImmediate(() => server.close());
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (done) return send(res, 410, 'Already finished', 'This sign-in link was already used. You can close this window.');
    const host = req.headers.host ?? '';
    if (req.method !== 'GET' || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      return send(res, 400, 'Bad request', 'Unexpected request.');
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname !== CALLBACK_PATH) return send(res, 404, 'Not found', 'Unknown path.');

    const state = url.searchParams.get('state') ?? '';
    if (!constantTimeEqual(state, opts.expectedState)) {
      // Don't settle: a stray or forged request must not cancel the real flow.
      return send(res, 400, 'Sign-in not recognised', 'This response does not match the sign-in you started. Close this window and try again from the terminal.');
    }
    const error = url.searchParams.get('error');
    if (error) {
      send(res, 400, 'Sign-in cancelled', 'Google did not grant access. You can close this window and return to the terminal.');
      return finish(() => settle.reject(new OAuthError(error, `Google returned "${error}"`)));
    }
    const code = url.searchParams.get('code');
    if (!code) return send(res, 400, 'Bad request', 'Missing authorization code.');
    send(res, 200, 'Account connected', 'You can close this window and return to the terminal.');
    finish(() => settle.resolve({ code, iss: url.searchParams.get('iss') }));
  });

  const timer = setTimeout(
    () => finish(() => settle.reject(new OAuthError('timeout', 'Timed out waiting for the Google sign-in to finish'))),
    opts.timeoutMs ?? 5 * 60_000,
  );
  timer.unref?.();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  return {
    redirectUri: `http://127.0.0.1:${port}`,
    result,
    close: async () => {
      finish(() => settle.reject(new OAuthError('cancelled', 'Sign-in cancelled')));
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
