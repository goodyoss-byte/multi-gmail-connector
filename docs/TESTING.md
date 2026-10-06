# Testing

```bash
npm run build      # the stdio end-to-end test runs the built server
npm test           # 97 tests, ~5 s, no network, no real accounts
npm run typecheck
```

No test uses real Google accounts or the network. `tests/helpers/fake-google.ts` fakes Google's token and revoke endpoints and the Gmail API. It records **which access token touched which mailbox**, enforces PKCE and the redirect URI on code exchange, and can inject 401/403/429/5xx responses, `invalid_grant` and refresh-token rotation. OAuth connect tests drive the **real** loopback listener over HTTP.

## Suites
| File | Covers |
|---|---|
| `tests/integration/multi-account.test.ts` | **Critical test**: accounts A and B, search all → every result labelled with the right account; no token, refresh token or client secret in MCP output; each Gmail call used only the owning account's token; B's message id through A's ref → `MESSAGE_NOT_FOUND` and B's mailbox untouched; search by label or selected ids; unknown account; include/exclude; tokens absent from config; partial results when one account needs reconnecting |
| `tests/integration/mcp-tools.test.ts` | Exactly five read-only tools with schemas and no write tools; schema rejection of bad input (no Gmail calls made); **pagination** across two interleaved accounts (30 messages, pages of 7: no gaps, no duplicates, globally newest-first); cursor misuse/tampering; **large messages** truncated within limits; **HTML sanitisation** (hidden text, scripts, pixels, invisible characters, long links); injection flagging; bounded threads; **attachments** (CSV/HTML extracted, PDF unsupported, 50 MB refused without download, unknown id); **Gmail errors** (429 with Retry-After, 5xx retry then fail, transient 5xx, 401 → refresh → retry, 403 → reconnect); **malformed messages** (no payload, bad base64, 100-deep nesting, 5,000 parts, broken headers); hard output cap |
| `tests/integration/accounts-oauth.test.ts` | Connect three accounts (opaque ids keyed by `sub`); exact scopes, PKCE S256, offline, account chooser, loopback redirect; **reconnect** same `sub` in place; wrong-account reconnect rejected and revoked; missing Gmail scope or refresh token rejected; unique labels; **disconnect** revokes and deletes; uninstall clears everything; config holds no credentials and is `0600`; **token refresh**: caching, concurrent de-duplication, early refresh, rotation stored, `invalid_grant` → `needs_reauth` → reconnect fixes it, missing keychain entry, bad client |
| `tests/unit/oauth.test.ts` | PKCE S256 checked against WebCrypto; `login_hint`; ID-token validation (issuer, audience, expiry, nonce, sub, email, malformed); **OAuth state validation** on the loopback (wrong state ignored, right state accepted once, error param, wrong path, foreign Host header, timeout, 127.0.0.1 binding) |
| `tests/unit/logging.test.ts` | **Logger redaction** of token shapes, URL parameters, sensitive keys at any depth and error messages; JSON lines; stderr only |
| `tests/unit/content.test.ts` | Invisible/bidi/control stripping; truncation (surrogate-safe); URL shortening; HTML hidden-element removal; malformed HTML; injection heuristics (positive and negative); address parsing; entity decoding; charset decoding; decode caps; Gmail query building and escaping |
| `tests/unit/storage.test.ts` | Config paths per OS; atomic `0600` config; refuses credentials in config; invalid config; **encrypted-file store** (no plaintext, wrong passphrase and moved ciphertext fail, passphrase length); keychain store works or fails with a clear error; per-account rate limiter |
| `tests/e2e/stdio.test.ts` | Spawns `node dist/cli.js serve`, completes the MCP handshake over stdio, lists tools, calls tools, checks stderr is JSON logs only |

## Checking that the tests catch bugs
The critical isolation tests were mutation-checked. Deliberately (1) labelling every result with account A, and (2) using account A's token for every mailbox each made the critical suite fail. Both changes were reverted.

## Not covered by automated tests (manual, before release)
- The real Google consent flow with real accounts (needs the owner's Google Cloud project): see [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
- Real OS keychains on macOS, Windows and a Linux desktop (CI containers have none).
- Claude Desktop and Claude Code picking up the server from the printed configuration.
