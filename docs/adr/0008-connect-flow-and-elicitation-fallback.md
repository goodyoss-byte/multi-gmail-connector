# ADR-0008: Connect mailboxes through a dashboard link; use URL elicitation only when Claude supports it

- Status: Superseded by ADR-0012 (hosted design; preserved in the private paid-edition repository)
- Date: 2026-09-27

## Context
Connecting a mailbox is a third-party OAuth flow that must happen in the user's browser. MCP's URL-mode elicitation is designed for exactly this, but Claude's support for elicitation (and for the 2026-07-28 multi-round-trip mechanism) is NOT VERIFIED. The MCP spec also warns of an account-linking phishing attack: an attacker starts a connect flow and gets a victim to complete it.

## Decision
- **Primary path:** `get_account_management_link` returns a plain dashboard URL (not pre-authenticated, no tokens or PII). `NO_ACCOUNTS_CONNECTED` and `ACCOUNT_NEEDS_RECONNECT` errors include the same URL as `action_url`.
- The dashboard requires sign-in; the connect flow starts only via a CSRF-protected POST from a signed-in session.
- `oauth_states` binds `state` to both `user_id` and the web session; the callback rejects any other session (account-linking defence). Single use, 10-minute TTL, PKCE, nonce, `iss` check.
- **Later:** when Claude declares `elicitation.url` support, the server may return the same server-owned connect URL as a URL elicitation. The same-user check still applies at the dashboard.

## Consequences
- ✅ Works on every Claude surface today.
- ✅ Phishing-resistant regardless of how the link is delivered.
- ❌ The user leaves the chat to connect accounts (one-time setup per mailbox).
