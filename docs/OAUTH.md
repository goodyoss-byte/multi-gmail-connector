# OAuth design (local edition)

How the connector gets and keeps permission to read each Gmail account. Code: `src/oauth/`, `src/accounts/`. Facts: research notes §3.2 and §7.3.

## 1. Client model
- Each user creates their **own** Google Cloud project and a **Desktop app** OAuth client ([ADR-0013](adr/0013-bring-your-own-google-oauth-client.md), [GOOGLE_CLOUD_SETUP.md](GOOGLE_CLOUD_SETUP.md)).
- Google treats Desktop client secrets as non-confidential. We still store it in the OS keychain and never print or log it.
- Only the `installed` (Desktop) JSON type is accepted; a `web` client is rejected with an explanation.

## 2. Scopes (minimum)
| Scope | Why |
|---|---|
| `openid` | ID token with the stable account id (`sub`) |
| `email` | Address for display and `login_hint` |
| `https://www.googleapis.com/auth/gmail.readonly` | Search and read mail. `gmail.metadata` can't use search queries, so this is the narrowest scope that supports search. |

Never requested: `gmail.modify`, `gmail.compose`, `gmail.send`, `https://mail.google.com/`. `include_granted_scopes` isn't sent (incremental authorisation isn't supported for installed apps).

## 3. Connect flow (`cmec add`)
1. Generate `state` (32 random bytes), PKCE `code_verifier` (48 random bytes → S256 challenge) and `nonce` (24 random bytes).
2. Start a one-shot HTTP listener on **127.0.0.1**, random port, root path, 5-minute timeout.
3. Open the browser at `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`, the three scopes, `access_type=offline`, `prompt=consent select_account`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, `redirect_uri=http://127.0.0.1:<port>`, and `login_hint` on reconnect. The URL is also printed for manual copying.
4. The listener accepts a request only if: method `GET`; `Host` is `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding guard); path `/`; `state` matches in constant time. Wrong-state requests get a 400 and **don't** end the flow; the first valid one ends it, and later ones get 410. The response page contains no secrets and is served with a strict CSP and `no-store`.
5. If an `iss` parameter is present it must be Google's issuer (RFC 9207).
6. Exchange the code at `https://oauth2.googleapis.com/token` with the verifier, the same redirect URI and the client credentials.
7. Validate:
   - granted `scope` includes `gmail.readonly`, otherwise revoke and stop ("click *Select all* / tick *View your email messages and settings*");
   - an ID token exists: `iss` is Google, `aud` = our client ID, `exp` not passed, `nonce` matches. The token comes straight from Google over TLS, so per OIDC Core §3.1.3.7 TLS replaces a signature check;
   - a refresh token exists (we send `prompt=consent`); otherwise revoke and explain.
8. Registry update keyed by **Google `sub`**:
   - existing `sub` → update in place (same id, label, settings);
   - `accounts reconnect <X>` but a different `sub` signed in → revoke the new token, change nothing, tell the user which account they used;
   - new `sub` → new `acc_…` id (max 25 accounts).
9. Write the refresh token to the keychain **first**, then `config.json`, so the config never points at a missing secret. If the config write fails for a new account, the secret is deleted.

## 4. Token use and refresh (`src/accounts/token-manager.ts`)
- Access tokens stay in memory only. They are refreshed when fewer than 5 minutes remain, or once after a Gmail 401.
- Concurrent requests for the same account share one refresh.
- If Google returns a new refresh token, it replaces the stored one.
- `invalid_grant` (revoked, expired, password changed, Testing-mode 7-day limit…) → the account is marked `needs_reauth` in `config.json`, and tools return `ACCOUNT_NEEDS_RECONNECT` with the exact command. Other accounts keep working.
- `invalid_client` → `NOT_CONFIGURED` ("run setup again").

## 5. Disconnect and uninstall
- `accounts remove <X>`: POST the refresh token to `https://oauth2.googleapis.com/revoke` (best effort, result reported), delete the keychain entry, remove the account from config.
- `uninstall`: the above for every account, plus deleting the client secret, config file and any encrypted secret file.

## 6. Why each user brings their own client
See [ADR-0013](adr/0013-bring-your-own-google-oauth-client.md). A shared client would make the project the developer of one restricted-scope app used by everyone. That needs Google verification plus an annual security assessment, and it would put the project's credentials in every copy of the code.

## 7. Future providers
Microsoft (Outlook.com / Microsoft 365) would use the Microsoft identity platform's desktop flow with loopback redirect and PKCE, `Mail.Read` + `offline_access`, keyed by `tid:oid`. Microsoft rotates refresh tokens on every use, which the token manager already handles.
