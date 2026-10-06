# Architecture — Local-First Edition

Status: design for the free, open-source, local-first edition (ADR-0009). Last updated 2026-09-27. Facts about external platforms are cited in [research/RESEARCH_NOTES.md](research/RESEARCH_NOTES.md) (§7 covers this edition).

## 1. What it is
A small program that runs **on the user's own computer**. Claude Desktop or Claude Code starts it as a local MCP server (stdio). It holds OAuth tokens for **several Gmail accounts** in the operating system's keychain and gives Claude **read-only** tools to search and read mail across them. Every result names the account it came from.

Nothing runs on our infrastructure. We never receive the user's passwords, tokens, emails, attachments or search queries.

## 2. Goals and non-goals
| Goals | Non-goals (V1) |
|---|---|
| Multiple Gmail accounts, one connector | Sending, drafting, deleting, labelling, moving, marking read |
| Read-only, minimum scope (`gmail.readonly`) | Hosted/multi-tenant service (that's the separate paid edition) |
| Tokens in OS keychain, never in plaintext files | IMAP / app passwords |
| Zero infrastructure and zero running cost | Background sync or a local mail index |
| Simple install: clone → `npm install` → `cmec setup` | Outlook/Microsoft 365 (designed for, not built) |
| Works with Claude Desktop and Claude Code | claude.ai web/mobile (they need a remote server) |

## 3. Components
```
┌──────────── user's computer ─────────────────────────────────────────────┐
│                                                                          │
│  Claude Desktop / Claude Code                                            │
│        │ spawns + talks MCP over stdin/stdout                            │
│        ▼                                                                 │
│  cmec serve  (MCP server, read-only tools)                               │
│    ├─ Tool layer ─ schemas, limits, pagination, error mapping            │
│    ├─ Account registry ─ config.json (no secrets)                        │
│    ├─ Token manager ─ refresh, in-memory access tokens                   │
│    ├─ Secret store ─ OS keychain (refresh tokens, client secret)         │
│    ├─ Gmail provider ─ REST calls, MIME parsing, normalisation           │
│    ├─ Content guard ─ HTML→text, hidden-text/bidi strip, injection flags │
│    ├─ Rate limiter ─ per-account quota budget                            │
│    └─ Logger ─ stderr only, redacted                                     │
│                                                                          │
│  cmec CLI  (setup wizard, accounts add/remove/…, doctor)                 │
│    └─ Loopback OAuth listener on 127.0.0.1:<random port>                 │
│                                                                          │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ HTTPS
            accounts.google.com / oauth2.googleapis.com / gmail.googleapis.com
```

| Component | Responsibility |
|---|---|
| **MCP server** (`cmec serve`) | Started by Claude over stdio. Exposes 5 read-only tools. Never writes to stdout except MCP messages. |
| **CLI** (`cmec …`) | Everything that changes state: set up the OAuth client, connect/reconnect/remove accounts, labels, include/exclude, doctor, uninstall. Account management is **not** exposed to Claude (ADR-0012). |
| **Account registry** | `config.json` in the per-user config directory (permissions `0600`): Google client ID, and for each account: `id`, `label`, `provider`, `provider_account_id` (Google `sub`), `email`, `status`, `include_in_search_all`, scopes, timestamps. **No secrets.** |
| **Secret store** | OS keychain via `@napi-rs/keyring` (macOS Keychain, Windows Credential Manager, Linux Secret Service). Holds the OAuth client secret and one refresh token per account. Opt-in encrypted-file fallback for headless Linux (ADR-0011). |
| **Token manager** | Exchanges refresh tokens for access tokens, keeps access tokens **in memory only**, de-duplicates concurrent refreshes, marks accounts `needs_reauth` on `invalid_grant`. |
| **Gmail provider** | Calls the Gmail REST API with the account's own access token; parses MIME; returns normalised objects. Behind a small `EmailProvider` interface for future providers. |
| **Content guard** | Converts HTML to text, strips hidden text and invisible/bidi characters, truncates, and flags text that looks like instructions to an AI. |
| **Rate limiter** | In-memory token bucket per account (4,800 of Google's 6,000 quota units/minute). |
| **Logger** | JSON lines to **stderr**; redacts tokens, secrets, codes and auth headers; never logs email content or search text. |

## 4. Identity and multi-account model
- An **account** = one connected mailbox. Its permanent identity is `(provider, provider_account_id)`, where `provider_account_id` is Google's `sub` from the ID token. Email is display data only.
- Local id: `acc_` + 16 random base32 characters. Users and Claude may also refer to an account by its **label** ("Personal", "Business"), case-insensitive; labels are unique.
- Connecting a Google account whose `sub` is already registered **updates** that account (reconnect). A new `sub` adds a new account. `accounts reconnect <label>` rejects a sign-in as a different Google account.
- There is exactly one local user, so "tenant isolation" becomes **account isolation**: each Gmail call uses only the token of the account it targets, and every result carries `account_id`, `account_label`, `email_address`, `provider`.

## 5. Data locations
| Data | Where | Protection |
|---|---|---|
| Google client ID, accounts list, labels, settings | `<config dir>/config.json` | File mode `0600`, dir `0700`, atomic writes |
| Google client secret | OS keychain, entry `google-client-secret` | OS keychain |
| Refresh tokens | OS keychain, entry `refresh-token:<account id>` | OS keychain |
| Access tokens | Process memory only | Never persisted |
| Email content, attachments, queries | Not stored. Short-lived in-memory metadata cache (5 min, message headers only) to avoid double fetches during pagination | Cleared on exit |
| Logs | stderr (Claude captures MCP server logs) | Redacted, no content |

Config directory: macOS `~/Library/Application Support/multi-gmail-connector`, Windows `%APPDATA%\multi-gmail-connector`, Linux `$XDG_CONFIG_HOME/multi-gmail-connector` (default `~/.config/…`). Override with `CMEC_CONFIG_DIR`.

## 6. Flows
**Connect an account** (CLI; details in [OAUTH.md](OAUTH.md)): start a listener on `127.0.0.1:<random>` → open the browser to Google with PKCE S256, `state`, `nonce`, `access_type=offline`, `prompt=consent select_account`, scopes `openid email gmail.readonly` → validate the callback (`state`, single use, timeout) → exchange the code → check the ID token (`iss`, `aud`, `exp`, `nonce`) and granted scopes → store the refresh token in the keychain → add/update the account in `config.json`.

**Tool call**: Claude → `tools/call` over stdio → validate input → re-read `config.json` if it changed (newly connected accounts appear without restarting Claude) → resolve account ids/labels → per-account rate limit → token manager supplies an access token → Gmail API → normalise, sanitise, truncate → `structuredContent` + text.

**Disconnect**: CLI revokes the refresh token at Google (best effort), deletes the keychain entry, and removes the account from `config.json`.

## 7. MCP interface (summary; full spec in [MCP_DESIGN.md](MCP_DESIGN.md))
| Tool | Purpose |
|---|---|
| `list_email_accounts` | Connected accounts, labels, status, how to manage them |
| `search_emails` | Search one, selected, or all accounts; merged, labelled, paginated |
| `get_email` | One message, bounded text |
| `get_thread` | A conversation, bounded |
| `get_attachment` | Bounded text of a text-type attachment |

All tools: `readOnlyHint: true`, JSON-Schema-validated input, `outputSchema` + `structuredContent`, hard output caps.

## 8. Technology choices
| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js ≥ 22 LTS, TypeScript | Official MCP SDK; Claude Desktop and Claude Code already rely on Node for local servers |
| MCP | `@modelcontextprotocol/server` v2 `serveStdio` | Stable line; serves 2026-07-28 and today's 2025-era clients over stdio |
| Validation | zod 4 (SDK peer) | Schemas become JSON Schema for `tools/list` |
| Keychain | `@napi-rs/keyring` | Maintained, prebuilt binaries for all three OSes |
| HTML → text | `html-to-text` | Robust with malformed HTML; no browser engine |
| Google APIs | Plain `fetch` to documented REST endpoints | No large SDK; easy to mock; small dependency tree |
| Tests | Vitest, in-memory MCP client, fake Google/Gmail | No real accounts needed in CI |

## 9. What's deliberately left out of V1
- Write operations of any kind (ADR-0005).
- PDF/Office attachment extraction (parsers add attack surface; planned).
- Model Armor or other cloud classifiers (would send email text to a cloud service; optional later).
- `.mcpb` Desktop Extension packaging (planned; needs the OAuth connect flow to work from inside Claude Desktop's extension settings).
- Microsoft Graph provider (interface ready).

## 10. Relationship to the paid edition
The hosted, multi-tenant design lives in the separate private repository `multi-gmail-connector-paid`. This edition shares the tool names, result shapes and provider interface, so users could move between them, but it has **no runtime dependency** on any hosted service.
