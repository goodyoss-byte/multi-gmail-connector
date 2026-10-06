# ADR-0002: Separate app identity from mailbox connections; key mailboxes by provider subject

- Status: Accepted (adapted for the local-first edition, see note)
- Date: 2026-09-27

> **Local-first edition note (2026-09-27):** Still applies in the local edition: accounts are keyed by Google `sub`, labels are unique, ids are opaque (`acc_` + 16 random base32 characters). There is no separate app-user identity: the local OS user is the only user.

## Context
A user must be able to connect several Gmail accounts (and later Microsoft accounts) under one Claude connector. Email addresses can change or be reassigned. Tying the app login to one mailbox would make "connect another Gmail" either impossible or a login switch.

## Decision
1. **App user** = one `users` row, signed in via Google OIDC (`openid email profile`) and identified by `(issuer, sub)` in `user_identities`.
2. **Mailbox** = one `email_connections` row owned by `user_id`, identified by `provider_account_id` = Google `sub` (Microsoft: `tid:oid`). The email address is display data only.
3. Uniqueness: **partial** `UNIQUE (user_id, provider, provider_account_id) WHERE deleted_at IS NULL`. Never `UNIQUE (user_id, provider)`.
4. Reconnecting the same `sub` updates the existing row; a new `sub` makes a new row; a reconnect that returns a different `sub` is rejected.
5. Public ids are opaque random strings (`acc_` + 26 base32 chars), not sequential.

## Consequences
- ✅ Unlimited mailboxes per user (capped by configuration at 25).
- ✅ Email renames don't break connections; reassigned addresses can't hijack them.
- ✅ Disconnected accounts can be reconnected later.
- ❌ Two identity concepts to explain in the UI ("You're signed in as X; connected mailboxes: A, B").
