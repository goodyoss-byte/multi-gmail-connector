# ADR-0007: Run our own OAuth 2.1 authorization server on `oidc-provider`

- Status: Superseded by ADR-0009 (no authorization server: stdio servers use local credentials) (hosted design; preserved in the private paid-edition repository)
- Date: 2026-09-27

## Context
Claude needs an OAuth AS to obtain tokens for our MCP server. Claude supports CIMD (if the AS advertises `client_id_metadata_document_supported: true` and `"none"` auth) and falls back to DCR; it requires PKCE S256, sends RFC 8707 `resource`, and uses only the first `authorization_servers` entry. MCP 2026-07-28 deprecates DCR in favour of CIMD. The MCP TypeScript SDK v2 moved its AS helpers to a frozen legacy package and recommends a dedicated library or IdP.

## Decision
Use **`oidc-provider`** (panva), mounted in the same service at the same origin as the MCP endpoint:
- CIMD (experimental in v9.7+) first, DCR fallback.
- PKCE S256 only, resource indicators, RFC 9207 `iss`, JWT access tokens (10 min, `aud` = MCP URI), rotating refresh tokens with reuse detection.
- Our own interaction pages (Google login, consent) and Postgres adapter.
- SSRF-safe fetcher for CIMD documents.

Delegating Claude's OAuth to Google directly is **not** possible: our MCP server must issue and validate its own audience-bound tokens and must not accept Google tokens (no passthrough).

## Consequences
- ✅ Full control of consent, trust policy and token lifetimes; no per-user IdP fees.
- ✅ Certified, widely used library.
- ❌ CIMD support is experimental; must pin and test the version. If it proves unstable, DCR alone still works with Claude.
- ❌ We own AS security (key rotation, abuse limits).

## Alternatives considered
- **Managed IdP (WorkOS AuthKit, Stytch, Auth0):** faster to start, CIMD claimed by some (third-party sources, NOT VERIFIED); adds cost and a vendor holding user identity. A reasonable fallback if `oidc-provider` CIMD is problematic.
- **SDK `ProxyOAuthServerProvider`:** deprecated/frozen.
- **Keycloak:** heavy to operate for a single-owner deployment.
