# Phase 0 Research Notes (verified sources)

Research date: **2026-09-27**. Every fact below was read from the cited page on that date unless it is marked **NOT VERIFIED**. These notes feed the architecture documents in `docs/` and the ADRs in `docs/adr/`. Re-check anything time-sensitive (quotas, pricing, policy) before relying on it.

---

## 1. Model Context Protocol (MCP)

### 1.1 Current specification: `2026-07-28`
Source: https://modelcontextprotocol.io/specification/latest (points to 2026-07-28), changelog https://modelcontextprotocol.io/specification/2026-07-28/changelog

Previous revision: `2025-11-25`. Major changes in 2026-07-28:
- **Stateless protocol.** `initialize` / `notifications/initialized` handshake removed. Every request carries protocol version and client capabilities in `_meta` (`io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`). Version mismatch → `UnsupportedProtocolVersionError`.
- **No protocol-level sessions.** `Mcp-Session-Id` header removed. Servers needing cross-call state mint explicit handles passed as ordinary tool arguments (SEP-2567).
- New required RPC `server/discover` (servers MUST implement).
- `subscriptions/listen` replaces the HTTP GET stream and `resources/subscribe`.
- `ping`, `logging/setLevel`, `notifications/roots/list_changed` removed.
- **Tasks** moved out of core into extension `io.modelcontextprotocol/tasks`.
- **Multi Round-Trip Requests (MRTR)** replace server-initiated requests (elicitation, sampling, roots): server returns `InputRequiredResult` (`resultType: "input_required"`) with `inputRequests`; client retries the original request with `inputResponses`; server may echo `requestState`.
- All results carry `resultType` (`"complete"` | `"input_required"`).
- SSE resumability (`Last-Event-ID`) removed from Streamable HTTP.
- Minor: `extensions` capability field; OpenTelemetry `_meta` keys; deterministic `tools/list` order (SHOULD); required headers `Mcp-Method`, `Mcp-Name` on Streamable HTTP POST; `ttlMs` + `cacheScope` on list/read results; resource-not-found error `-32602`; RFC 9207 `iss` in authorization responses (AS SHOULD emit, client MUST validate if present); DCR clients must send `application_type`; client credentials bound to issuing AS; `inputSchema`/`outputSchema` accept any JSON Schema 2020-12; `structuredContent` may be any JSON value; spec-reserved error range `-32020..-32099`.
- **Deprecated:** Roots, Sampling, Logging; HTTP+SSE transport; `includeContext` values `thisServer`/`allServers`; **Dynamic Client Registration (RFC 7591) deprecated in favour of Client ID Metadata Documents (CIMD)** — retained for backwards compatibility.
- Extensions listed: Tasks, Skills over MCP, MCP Apps.

### 1.2 Authorization (2026-07-28)
Source: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization and `/security-considerations`

- Authorization is OPTIONAL; HTTP transports SHOULD conform; STDIO SHOULD NOT (use environment credentials).
- MCP server = OAuth 2.1 resource server. AS MUST implement OAuth 2.1.
- AS and clients SHOULD support CIMD; MAY support DCR (deprecated).
- MCP servers MUST implement RFC 9728 Protected Resource Metadata; clients MUST use it for AS discovery.
- AS MUST provide RFC 8414 metadata or OIDC Discovery; AS using OIDC discovery MUST include `code_challenge_methods_supported`.
- Clients MUST use PKCE (S256 when capable) and MUST refuse if the AS metadata lacks `code_challenge_methods_supported`.
- Clients MUST send RFC 8707 `resource` (canonical MCP server URI) in authorization and token requests.
- Servers MUST validate token audience; "MCP servers **MUST NOT** accept or transit any other tokens"; token passthrough forbidden; upstream API tokens are separate tokens the server obtains as an OAuth client.
- Tokens only in `Authorization: Bearer` header; never in query string. Invalid/expired → HTTP 401.
- Scope challenge: 401 `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`; runtime insufficient scope → **403** `error="insufficient_scope"` with all required scopes in one challenge; step-up flow.
- Servers SHOULD NOT put `offline_access` in `WWW-Authenticate` or `scopes_supported`.
- AS SHOULD issue short-lived access tokens; for public clients AS MUST rotate refresh tokens.
- All AS endpoints HTTPS; redirect URIs localhost or HTTPS; AS MUST validate exact redirect URIs.
- **Confused deputy:** "MCP proxy servers using static client IDs **MUST** obtain user consent for each dynamically registered client before forwarding to third-party authorization servers."
- CIMD security: AS fetching client metadata SHOULD mitigate SSRF; SHOULD warn for localhost-only redirect URIs; MUST clearly display redirect URI hostname.

### 1.3 Security Best Practices (2026-07-28)
Source: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices

- **Confused deputy mitigations (MUST, for MCP proxy servers):** per-user registry of approved `client_id`s checked before starting third-party auth; MCP-owned consent page that names the client, shows third-party scopes and the registered `redirect_uri`, has CSRF protection and anti-framing (`frame-ancestors`/`X-Frame-Options: DENY`); consent cookies use `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, signed, bound to `client_id`; exact-string redirect URI match; `state` random, stored server-side **only after** consent, single-use, short TTL (~10 min), validated at callback.
- **Token passthrough:** "MCP servers **MUST NOT** accept any tokens that were not explicitly issued for the MCP server."
- **SSRF:** applies to MCP clients and to an AS fetching CIMD URLs — HTTPS only, block private/link-local ranges (incl. `169.254.169.254`), validate redirects, egress proxy (e.g. Smokescreen), beware DNS rebinding.
- **State handle hijacking** (replaces "session hijacking" now that sessions are gone): servers MUST verify all inbound requests; MUST NOT treat possession of a handle as authentication; SHOULD use random handles bound server-side to `<user_id>:<handle>` with user id from the verified token.
- Local server compromise, OAuth authorization URL validation (client-side), stdio proxy risks, mix-up attacks (RFC 9207), localhost redirect impersonation, CIMD trust policies.
- **Scope minimization:** minimal initial scopes, incremental elevation via targeted challenges, log elevation events.

### 1.4 Elicitation (2026-07-28)
Source: https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation

- Two modes: **form** (in-band, flat primitive schema) and **URL** (out-of-band navigation; data other than the URL not exposed to client).
- Servers MUST NOT request passwords/API keys/tokens/payment credentials via form mode; MUST use URL mode for them.
- URL mode is explicitly the pattern for an MCP server acting as an **OAuth client to a third-party API** (our Gmail case): third-party credentials MUST NOT transit the MCP client; server MUST NOT use the client's token upstream; server stores tokens bound to the user identity.
- Safe URL handling: server MUST NOT put PII/credentials in the URL; MUST NOT provide a pre-authenticated URL.
- **Phishing / account-linking attack:** attacker triggers an elicitation and gets a victim to complete the third-party OAuth, binding the victim's account to the attacker. Server **MUST** ensure the user completing the flow is the same user who started it — e.g. elicit a server-owned "connect URL" that checks the browser session's subject equals the MCP token's subject before redirecting to the third-party AS.
- Clients MUST declare `elicitation: { form: {}, url: {} }` capability; servers MUST NOT use unsupported modes.
- URL mode is marked "new feature, may change".

### 1.5 MCP TypeScript SDK
Sources: https://github.com/modelcontextprotocol/typescript-sdk, https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28, search results for the v2 upgrade guide.

- **v2** implements 2026-07-28. Packages: `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, middleware `@modelcontextprotocol/node`, `/express`, `/fastify`, `/hono`. v1.x gets fixes for ≥6 months after v2.
- `createMcpHandler(factory)` serves 2026-07-28 per request and, by default (`legacy: 'stateless'`), 2025-era clients too; `legacy: 'reject'` refuses them.
- `inputRequired(...)` works for both eras (legacy shim converts to real server→client requests; `maxRounds` default 8, `roundTimeoutMs` default 600000).
- Validates `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` headers → 400 / `-32020` on mismatch.
- Resource-server helpers (`requireBearerAuth`, `mcpAuthMetadataRouter`, `verifyBearerToken`, `OAuthTokenVerifier`) remain (`@modelcontextprotocol/express`, `@modelcontextprotocol/server`).
- **Authorization-server helpers (`mcpAuthRouter`, `ProxyOAuthServerProvider`) moved to `@modelcontextprotocol/server-legacy/auth` (deprecated, frozen).** SDK recommends a dedicated IdP/OAuth library for the AS.
- Node 20+ (from search result; NOT VERIFIED on the SDK page itself).

### 1.6 Authorization-server options that support CIMD (third-party sources, NOT VERIFIED against vendor docs)
- `oidc-provider` (panva): experimental CIMD since v9.7.0 (March 2026), tracking draft -02.
- Keycloak: experimental CIMD.
- WorkOS AuthKit, Stytch: listed as supporting CIMD.
- Auth0: "coming soon" (per a WorkOS blog — competitor source).

---

## 2. Claude (Anthropic)

### 2.1 Custom connectors (remote MCP)
Sources: https://claude.com/docs/connectors/custom/remote-mcp, https://claude.com/docs/connectors/building/index.md, https://claude.com/docs/connectors/building/authentication.md, https://claude.com/docs/connectors/building/lazy-authentication.md

- Add by URL on **Free (one custom connector), Pro, Max, Team, Enterprise**. On Team/Enterprise an Owner adds it; members connect with their own accounts.
- Same connector infrastructure backs claude.ai, Desktop, mobile, Cowork and Claude Code.
- Auth types: `oauth_dcr` (default), `oauth_cimd` (default), `oauth_anthropic_creds` (contact `mcp-review@anthropic.com`), `custom_connection` (contact), `static_headers` (beta, limited orgs), `none`.
- Claude follows the **2025-03-26, 2025-06-18 and 2025-11-25** authorization specs. Support for the 2026-07-28 protocol revision in Claude's client is **NOT VERIFIED**.
- Hosted-app callback: **`https://claude.ai/api/mcp/auth_callback`**. Claude Code uses a loopback redirect on an ephemeral port; accept `http://localhost/callback` and `http://127.0.0.1/callback` port-agnostically. Claude Code CIMD: `https://claude.ai/oauth/claude-code-client-metadata`.
- Claude uses CIMD only if AS metadata advertises `"client_id_metadata_document_supported": true` **and** `"none"` in `token_endpoint_auth_methods_supported`; otherwise falls back to DCR (`registration_endpoint`).
- PKCE S256 on every authorization request; AS must advertise `code_challenge_methods_supported: ["S256"]`.
- Scopes requested = `scope` in the 401 `WWW-Authenticate`, else PRM `scopes_supported`; Claude appends `offline_access` if the AS lists it.
- A **401** with `WWW-Authenticate: Bearer resource_metadata="…"` is required to start sign-in; a 200 with `isError: true` does **not** trigger auth. 403 + `insufficient_scope` triggers step-up.
- Claude uses only the **first** `authorization_servers` entry.
- Latency limits: discovery/registration/token endpoints 10 s; refresh 30 s.
- Refresh: reactive on 401 and proactive up to 5 min before expiry; return `invalid_grant` for dead refresh tokens; rotate refresh tokens for public clients (DCR/CIMD register Claude as a public client).
- Token endpoint must accept `application/x-www-form-urlencoded`.
- Anthropic egress IP range: **`160.79.104.0/21`**.
- Discovery metadata cached ~5 minutes globally per server URL.
- Not supported by Claude: resource subscriptions, sampling, "advanced or draft capabilities". Elicitation / MRTR / URL-mode support in Claude: **NOT VERIFIED** (not listed as supported).
- Limits: **~150,000 characters** max tool result (claude.ai/Desktop); **240 s** per tool call; Claude Code 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`), timeout via `MCP_TOOL_TIMEOUT`.
- Tool results: text and image content; resources text/binary. MCP Apps (interactive UI) supported.
- Users can turn connectors on/off per chat and set individual tools to **Blocked**; "Always allow" per tool exists.
- Whether the same custom-connector URL can be added twice (one per mailbox): **NOT VERIFIED**.

### 2.2 Connectors Directory review criteria
Source: https://claude.com/docs/connectors/building/review-criteria.md

- Every tool needs `title` plus `readOnlyHint: true` or `destructiveHint: true`; "Read-only tools can run without per-call confirmation, and destructive tools always prompt."
- Separate read and write tools; no catch-all `api_request` tool. Names ≤ 64 chars. Narrow, accurate descriptions.
- Descriptions must not instruct Claude (no calling unrequested tools, no pulling instructions from external sources, no hidden/encoded instructions, no overriding system instructions).
- Actionable errors (no bare "Internal Server Error"); reasonably sized responses; don't collect conversation data; don't query Claude memory/chat history.
- Must call first-party or legitimately proxied APIs; MCP server domain should match the service.
- Not accepted: money/crypto transfer; AI image/video/audio generation.
- Submission needs test credentials for a populated account and public documentation.

### 2.3 Claude's built-in Gmail connector
Source: https://claude.com/docs/connectors/google/gmail.md

- Read-only search with citations; Pro/Max/Team/Enterprise. "Claude accesses only data from **the** Google account you connected" — single account.
- Third-party guides and GitHub issue `anthropics/claude-code#27567` ("Multi-account MCP connectors … two Gmail accounts") confirm one account at a time. Official docs do not state the limit explicitly → treat "one account only" as strongly implied, **NOT VERIFIED** as an explicit official statement.

### 2.4 Skills
Source: https://claude.com/docs/skills/overview.md

- Skills = instructions + scripts loaded on demand, run in Claude's code sandbox (code execution must be on). Plugins bundle skills + connectors. Connectors (MCP) are how Claude reaches external services. A skill is not a credential store or an authenticated backend.

---

## 3. Google

### 3.1 Google's own Gmail MCP server (alternative to building)
Source: https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server

- Endpoint `https://gmailmcp.googleapis.com/mcp/v1`; **Developer Preview** (Google Workspace Developer Preview Program enrollment required); enable `gmail.googleapis.com` and `gmailmcp.googleapis.com`.
- Scopes `gmail.readonly` + `gmail.compose`. For Claude: create your own OAuth web client with redirect `https://claude.ai/api/mcp/auth_callback`, add as custom connector with client ID/secret.
- Documented tools: `create_draft`, `list_drafts`, `get_thread`, `get_message`, `search_threads`, `label_thread`/`unlabel_thread`, `label_message`/`unlabel_message`, `list_labels`, `create_label`. (A live connection observed in this environment exposed a larger set incl. `send_message`, `reply`, `forward`, `trash_*` — which list is current is NOT VERIFIED.)
- Multi-account support not documented (one OAuth identity per connector instance).

### 3.2 OAuth 2.0 for web server apps
Sources: https://developers.google.com/identity/protocols/oauth2/web-server, https://accounts.google.com/.well-known/openid-configuration, https://developers.google.com/identity/protocols/oauth2

- Endpoints: authorize `https://accounts.google.com/o/oauth2/v2/auth`; token `https://oauth2.googleapis.com/token`; revoke `https://oauth2.googleapis.com/revoke`; userinfo `https://openidconnect.googleapis.com/v1/userinfo`; JWKS `https://www.googleapis.com/oauth2/v3/certs`; issuer `https://accounts.google.com`.
- Discovery advertises `code_challenge_methods_supported: ["plain","S256"]` and RFC 9207 `iss` support. The web-server guide itself does not document PKCE → PKCE for confidential web clients is supported by the AS metadata but not described in the guide (treat as supported-by-metadata).
- Parameters: `access_type=offline`; `prompt` = `none` | `consent` | `select_account` (space-delimited); `include_granted_scopes`; `enable_granular_consent` (default true); `login_hint` (email or `sub`); `state` (CSRF).
- Refresh token is returned only on the first authorization unless the user re-consents (`prompt=consent`).
- Granular consent: users may grant a subset — check the `scope` field of the token response.
- DPoP mentioned as optional for token binding — details NOT VERIFIED.
- Redirect URI rules: HTTPS (localhost exempt), no raw IPs, public-suffix TLD, no `googleusercontent.com`, no fragments/wildcards/open redirects.
- Refresh token stops working when: user revokes; unused 6 months; **password change when the token has Gmail scopes**; account exceeds max live refresh tokens; time-based access expired; admin restricted the service; GCP session control; **Testing publishing status → 7-day expiry** (unless only basic profile scopes).
- **Limit: 100 refresh tokens per Google Account per OAuth client ID** (plus an unspecified larger cross-client limit).

### 3.3 Gmail scopes
Source: https://developers.google.com/workspace/gmail/api/auth/scopes

| Class | Scopes |
|---|---|
| Non-sensitive | `gmail.labels`, `gmail.addons.current.action.compose`, `gmail.addons.current.message.action` |
| Sensitive | `gmail.send`, `gmail.addons.current.message.metadata`, `gmail.addons.current.message.readonly` |
| **Restricted** | `https://mail.google.com/`, **`gmail.readonly`**, `gmail.compose`, `gmail.insert`, `gmail.modify`, `gmail.metadata`, `gmail.settings.basic`, `gmail.settings.sharing` |

- `gmail.metadata` **cannot use the `q` search parameter** (source: users.messages.list reference). → Minimum scope for search + read = **`gmail.readonly` (restricted)**.

### 3.4 Gmail API quotas (new model from 1 May 2026)
Sources: https://developers.google.com/workspace/gmail/api/reference/quota, https://developers.google.com/workspace/tools-safety

- Per project: **1,200,000 quota units / minute**. Per user per project: **6,000 units / minute**.
- **Daily billing threshold: 80,000,000 units / project / day** — cannot be increased; exceeding it is "planned to incur charges … later in 2026" with ≥90 days' notice. Projects created on/after 1 May 2026 get the new quotas; projects active Nov 2025–Apr 2026 keep previous quotas for now.
- Costs: `users.getProfile` 1; `messages.list` 5; **`messages.get` 20**; `threads.list` 10; **`threads.get` 40**; `messages.attachments.get` 20; `history.list` 2; `drafts.create` 10; `messages.send` 100; `watch` 100; `labels.list` 1.
- Batch: max 100 calls, recommend ≤50; each call counts separately.
- `messages.list`: `maxResults` default 100, max 500; returns only `id` + `threadId`.
- Tiering model (tools-safety page): later in 2026 quota increases require billing; paid tier for scaled access.

### 3.5 Verification (restricted scopes)
Sources: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification, https://support.google.com/cloud/answer/13464323, https://support.google.com/cloud/answer/7454865, https://support.google.com/cloud/answer/15549945, https://support.google.com/cloud/answer/13465431, https://appdefensealliance.dev/casa/casa-tiering

- Restricted-scope verification: brand verification (domain via Search Console, public homepage, privacy policy on same domain disclosing Google-data use and complying with User Data Policy + Limited Use), unlisted YouTube demo video of consent flow and each scope's use, scope justification.
- **Security assessment:** "Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment." CASA via App Defense Alliance; assurance levels **AL1 / AL2**, chosen by Google from user count, scopes and other signals; revalidate **every 12 months**. Cost is agreed with the assessor (third-party-reported ~US$540–1,800/yr for lower level, US$6,000+ for comprehensive — **NOT VERIFIED**). Timeline "several weeks".
- Verification not needed: personal use (<100 users, unverified-app screen shown); dev/test/staging projects; service-owned data; internal Workspace-org apps; admin-trusted apps.
- Unverified app: **100 new users total over the project's lifetime, cannot be reset.**
- Testing status: up to **100 test users**; authorizations expire after **7 days** (except basic-profile scopes).

### 3.6 Google Workspace API User Data and Developer Policy (last updated 2026-09-03)
Source: https://developers.google.com/workspace/workspace-api-user-data-developer-policy

- Required security measures for **restricted scopes** include: "Protecting against prompt injection techniques by either using Google Cloud Platform's Model Armor or other prompt injection protection."
- Transparency/control: "granularly require users to confirm the MCP, tool, skill, or other agentic behavior invocation."
- No using data to train AI/ML models beyond the user's personalized model; Limited Use; transfers only for user-facing features with consent, security, law, M&A; no human reading without explicit consent (exceptions); encryption in transit and at rest, key management, CASA.
- How Google applies "granularly require users to confirm" to a read-only MCP connector whose tools Claude may auto-run: **NOT VERIFIED** — open compliance question.

### 3.7 Cross-Account Protection (RISC)
Source: https://developers.google.com/identity/protocols/risc
- Events: `sessions-revoked`, `tokens-revoked`, `token-revoked`, `account-disabled` (reasons `hijacking`, `bulk-account`), `account-enabled`, `account-credential-change-required`, `verification`. Signed JWTs to a registered HTTPS receiver; validate via `.well-known/risc-configuration` + JWKS, `aud` = client ID. Eligibility: app requests `profile` or `email` in Google Sign-in.

### 3.8 Model Armor (Google Cloud)
Sources: https://cloud.google.com/security/products/model-armor (search results), https://docs.cloud.google.com/model-armor/overview
- REST API usable with any LLM incl. Anthropic; detects prompt injection/jailbreak, sensitive data, malicious URLs; prompt-injection/jailbreak filter supports 10,000 tokens (other filters 2,000). Free tier exists; paid via Security Command Center or standalone — exact prices **NOT VERIFIED**.

---

## 4. Microsoft (future phase)
Sources: https://learn.microsoft.com/en-us/graph/permissions-reference, https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens, https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview, https://learn.microsoft.com/en-us/graph/search-query-parameter, https://learn.microsoft.com/en-us/graph/throttling-limits

- Delegated `Mail.Read` ("Read user mail"): no admin consent required; available for personal Microsoft accounts. Also `Mail.ReadBasic`, `Mail.ReadWrite` (no send), `Mail.Send`, `User.Read`.
- Refresh tokens: default **90 days** (24 h for SPA); "Refresh tokens replace themselves with a fresh token upon every use… Securely delete the old refresh token after acquiring a new one." Revocation matrix: password change revokes password-based tokens; confidential-client tokens survive user password change but not admin reset in Entra/M365 admin centers.
- Publisher verification: needs Microsoft AI Cloud Partner Program (PGA) account, verified publisher domain (not `*.onmicrosoft.com`), app registered with an Entra work/school account; free. Since Nov 2020, with risk-based step-up consent, users can't consent to unverified multitenant apps registered after 8 Nov 2020 that request more than basic sign-in from other tenants.
- `$search` on messages returns up to **1,000** results sorted by sent date; KQL properties `from`, `to`, `subject`, `body`, `received`, `hasAttachments`, `participants`, etc.
- Graph global limit: 130,000 requests / 10 s per app across tenants. Outlook per-mailbox limits (10,000 requests / 10 min, 4 concurrent) appear in Microsoft Q&A but **not on the current official throttling page → NOT VERIFIED**; design for ≤4 concurrent requests per mailbox and honour `Retry-After`.

---

## 5. Pricing (verified 2026-09-27, USD, list prices, us-central1 / Tier 1 unless noted)
The pages were fetched as raw HTML because the summariser truncated them.

| Service | Price read from the page | Source |
|---|---|---|
| Cloud KMS, software key | Active symmetric AES-256 key version **$0.000082192/hour (≈ $0.06/month)**; key-use operations **$0.03 per 10,000**; key admin operations free | https://cloud.google.com/kms/pricing |
| Secret Manager | Active secret versions: first **6 free**, then $0.000082192/hour (≈ $0.06/month); access operations: first **10,000/month free**, then **$0.03 per 10,000**; rotation notifications: 3 free, then $0.05 each; management operations free | https://cloud.google.com/secret-manager/pricing |
| Cloud Run services, request-based billing | CPU active **$0.000024/vCPU-s**; memory active **$0.0000025/GiB-s**; idle min-instance CPU **$0.0000025/vCPU-s**, idle memory $0.0000025/GiB-s; requests **$0.40 per million**. Free tier per month: **180,000 vCPU-s, 360,000 GiB-s, 2 million requests** | https://cloud.google.com/run/pricing |
| Cloud Run services, instance-based billing | CPU $0.000018/vCPU-s; memory $0.000002/GiB-s. Free tier 240,000 vCPU-s, 450,000 GiB-s | same |
| Cloud SQL (shared core) | **db-f1-micro $0.0105/hour** (HA $0.021); **db-g1-small $0.035/hour** (HA $0.07). Shared-core types are **not covered by the Cloud SQL SLA**. | https://cloud.google.com/sql/pricing |
| Cloud SQL storage (first region table on the page) | SSD $0.000232877/GiB-hour (≈ $0.17/GiB-month); HA SSD $0.000465753/GiB-hour; backups $0.000109589/GiB-hour (≈ $0.08/GiB-month). The page did not say which region this table is for; we assume us-central1 (**region NOT VERIFIED**). | same |
| Model Armor (pay-as-you-go) | **Free up to 2 million tokens/month**, then **$0.10 per additional 1 million tokens**; also included with SCC Premium/Enterprise subscriptions (3 billion tokens/month) | https://cloud.google.com/security/products/model-armor |
| Claude plans | Free $0; **Pro $20/month** (billed monthly); Max from $100/month; Team Standard $25, Team Premium $125 (billed monthly); Enterprise seat price + usage at API rates. The pricing page does not state custom-connector availability per plan; see §2.1 for that. | https://claude.com/pricing |

Still **NOT VERIFIED**: CASA assessor fees (third-party reports only); dedicated-core Cloud SQL per-vCPU prices (not extracted); network egress; Gmail API charges above 80M units/day (not published yet).

---

## 6. Handoff: decisions formed so far (to be written up as docs + ADRs)
1. **Integration:** remote MCP server (Streamable HTTP, SDK v2 `createMcpHandler` serving both 2026-07-28 and 2025-era clients) used as a Claude custom connector, with our own OAuth 2.1 authorization server (CIMD first, DCR fallback, PKCE S256, RFC 8707 audience, RFC 9207 `iss`, refresh-token rotation). AS built on a dedicated library (e.g. `oidc-provider`) or a managed IdP, not the frozen SDK helpers. Web dashboard for connecting/managing mailboxes. Optional skill/plugin for usage guidance only. Not a skill alone; not the built-in connector.
2. **Identity split:** app user identity (login) is separate from mailbox connections. Mailbox connect uses a separate Google OAuth client with `openid email gmail.readonly`, `access_type=offline`, `prompt=consent select_account`, `state` + PKCE + `nonce`, `login_hint` on reconnect.
3. **Multi-account key:** stable provider subject (Google `sub`, Microsoft `tid`+`oid`), never email. Uniqueness `UNIQUE(user_id, provider, provider_account_id)` as a partial index over non-deleted rows; reconnect of the same `sub` updates credentials in place; a new `sub` creates a new connection. Opaque random connection IDs (not sequential `gmail_001`).
4. **Connect flow security:** server-owned connect URL; the browser session user must equal the MCP token subject (account-linking/phishing defence); state bound to user; verify granted scopes include `gmail.readonly`.
5. **Tokens:** envelope encryption — per-connection DEK, AES-256-GCM, AAD bound to connection/user/provider/key version, DEK wrapped by Cloud KMS KEK; tokens never leave the credential service; refresh-token replacement handled atomically; RISC receiver for revocations.
6. **Tools V1 (read-only):** `list_email_accounts`, `search_emails` (all accounts when `account_ids` omitted — no separate `search_all_accounts`), `get_email`, `get_thread`, `get_attachment` (bounded text extraction), `get_account_management_link`. Every result carries `account_id`, `account_label`, `provider`, `email_address`, namespaced `message_ref`.
7. **Quota reality:** a 25-result Gmail search with metadata costs ~5 + 25×20 = 505 units → ~11 such searches/min per mailbox under the 6,000 units/min per-user limit. Needs per-mailbox token buckets, result caps and possibly short-lived metadata caching.
8. **Prompt injection:** read-only V1 is the main control; plus content sanitisation, provenance-labelled structured output, size limits, and a prompt-injection classifier (Model Armor or equivalent) because the Workspace policy requires one for restricted scopes.
9. **Future writes:** separate tools per action with `destructiveHint`; two-phase prepare → out-of-band confirm (dashboard, or URL elicitation once Claude supports it) → execute; Google incremental auth per connection; MCP 403 `insufficient_scope` step-up for our own scopes.
10. **Blockers to report:** Google restricted-scope verification + annual CASA for >100 users / any public launch; Workspace policy's prompt-injection and granular-confirmation requirements; Gmail billing above 80M units/day not yet published; Claude support for elicitation / 2026-07-28 not verified; Microsoft publisher verification prerequisites. Personal-use path: the user's own GCP project "In production" but unverified (warning screen, ≤100 users lifetime) avoids the Testing-mode 7-day expiry.

Remaining work for Phase 0 is listed in the original brief: README, the 14 docs, ADRs, then the 13-point summary, then STOP and wait for approval before Phase 1.

---

## 7. Local-first edition research (2026-09-27, second pass)
The project changed direction to a free, local-first, open-source edition (see ADR-0009). The hosted design is preserved in the private `claude-multi-email-connector-paid` repository. In this pass `developers.google.com` and `modelcontextprotocol.io` were blocked by the session's network policy, so Google facts come from the Context7 mirror of Google's official pages (source URLs quoted), and MCP facts from the SDK's published package.

### 7.1 Claude clients and local (stdio) MCP servers
- **Claude Code** (https://code.claude.com/docs/en/mcp): `claude mcp add [options] <name> -- <command> [args...]`; scopes `local` (default, `~/.claude.json`), `project` (`.mcp.json`, shared), `user` (`~/.claude.json`, all projects). `--env KEY=value`. Windows: `cmd /c`. Output warning at **10,000 tokens**, default max **25,000 tokens** (`MAX_MCP_OUTPUT_TOKENS`); larger results are saved to a file. Per-tool `_meta["anthropic/maxResultSizeChars"]` (hard ceiling 500,000 chars). `MCP_TIMEOUT` (startup), `MCP_TOOL_TIMEOUT`. Docs warn servers that fetch external content expose users to prompt-injection risk.
- **Claude Desktop** (https://support.claude.com/en/articles/10949351): local MCP servers install as **Desktop Extensions (`.mcpb`)** — Settings → Extensions, or "Install Extension…" for a custom file. macOS, Windows and Linux. Claude Desktop ships its own Node.js. Manifest fields marked `"sensitive": true` are encrypted with the OS secure storage (Keychain / Credential Manager / distro keychain). The article doesn't document manual `claude_desktop_config.json` editing; the commonly documented locations (`~/Library/Application Support/Claude/claude_desktop_config.json`, `%APPDATA%\Claude\claude_desktop_config.json`) are **NOT VERIFIED** in this pass.
- `@anthropic-ai/mcpb` 2.1.2 exists on npm (packaging CLI for `.mcpb`).

### 7.2 MCP TypeScript SDK v2 (npm, inspected locally)
- `@modelcontextprotocol/server` **2.1.0** (2026-09-23): "v2 is the stable release line, implementing the 2026-07-28 MCP spec".
- `serveStdio(factory, { legacy: 'serve' })` from `@modelcontextprotocol/server/stdio`: the opening exchange picks the era; a 2025-era `initialize` is served "exactly as a hand-wired stdio server" → compatible with today's Claude clients.
- `McpServer.registerTool(name, { title, description, inputSchema: z.object(...), outputSchema, annotations, _meta }, cb)`; input validation errors return `isError: true`. `InMemoryTransport.createLinkedPair()` + `@modelcontextprotocol/client` `Client` work for in-process tests (verified by a local probe).
- Needs zod ^4.2; TypeScript ≥ 6 requires `"types": ["node"]`.
- MCP spec (research §1.2): stdio servers SHOULD NOT use the MCP authorization flow; they take credentials from the environment/local storage.

### 7.3 Google OAuth for installed (desktop) apps
Source URLs via Context7 mirror: https://developers.google.com/identity/protocols/oauth2/native-app, …/oauth2, …/oauth2/resources/loopback-migration
- Loopback redirect: "applications should use `http://127.0.0.1:port` or `http://[::1]:port` … start an HTTP listener on a random available port." Manual copy/paste is deprecated. Loopback is deprecated for **Android/iOS/Chrome** client types only: "**Desktop app OAuth client types using this flow will continue to be supported.**"
- PKCE (`code_challenge_method=S256`) is shown in Google's own loopback examples.
- "Incremental authorization is not supported for installed applications because these clients **cannot keep the client_secret confidential**." → the Desktop client secret isn't a real secret, but it's still per-user and must never be committed or shipped by us.
- Refresh-token rules unchanged from §3.2: Testing + External → **7-day** expiry (unless only basic profile scopes); 100 refresh tokens per Google Account per client ID (the oldest is invalidated); revocation, 6 months unused, password change with Gmail scopes, admin/session policies. Revoke: `POST https://oauth2.googleapis.com/revoke?token=…`.
- OpenID Connect Core §3.1.3.7 allows TLS server validation instead of signature checks for an ID token received directly from the token endpoint; we still check `iss`, `aud`, `exp` and `nonce`.

### 7.4 OS keychain from Node
- `@napi-rs/keyring` **2.1.0** (2026-09-13): prebuilt native bindings to macOS Keychain, Windows Credential Manager and Linux Secret Service. `keytar` last published 7.9.0 and is no longer maintained (its GitHub repo is archived; archive date NOT VERIFIED in this pass).
- Probe in this headless Linux container: `Couldn't access platform storage: AccessDenied` → headless Linux / CI without a Secret Service needs a documented fallback. Tests use an in-memory store.
- Windows Credential Manager limits a credential blob to 2,560 bytes (Win32 `CRED_MAX_CREDENTIAL_BLOB_SIZE`; from Microsoft docs, not re-fetched → NOT VERIFIED here). Design stores **only the refresh token** per keychain entry and keeps access tokens in memory.

### 7.5 Policy notes for self-hosted users
- Each user creates their own Google Cloud project and Desktop OAuth client, and is the only user of it. The personal-use exemption applies (§3.5), so no verification or CASA is needed. They should set publishing status to **In production** (unverified) to avoid the 7-day Testing expiry, and will see the unverified-app screen once per account.
- The Workspace policy's prompt-injection requirement (§3.6) is written for developers of restricted-scope apps. How it applies to a user running their own personal project is **NOT VERIFIED**; the local edition ships built-in heuristic defences and documents optional Model Armor use.
