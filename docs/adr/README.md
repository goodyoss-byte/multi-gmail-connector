# Architecture Decision Records

This repository is the **free, local-first, open-source edition**. ADRs 0001–0008 were written for an earlier hosted design. They are kept for history, and the ones that no longer apply are marked superseded.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-integration-method.md) | Remote MCP server as a Claude custom connector | Superseded by 0009, 0010 |
| [0002](0002-multi-account-identity.md) | Key mailboxes by provider `sub`; email is display-only | Accepted (adapted) |
| [0003](0003-token-storage.md) | Envelope encryption with Cloud KMS | Superseded by 0011 |
| [0004](0004-provider-abstraction.md) | `EmailProvider` interface | Accepted (adapted) |
| [0005](0005-read-only-v1.md) | Read-only V1 | Accepted |
| [0006](0006-database.md) | PostgreSQL on Cloud SQL | Superseded by 0009 |
| [0007](0007-authorization-server.md) | Own OAuth 2.1 authorization server | Superseded by 0009 |
| [0008](0008-connect-flow-and-elicitation-fallback.md) | Dashboard connect link | Superseded by 0012 |
| [0009](0009-local-first-open-source.md) | **Pivot: local-first open-source edition** | Accepted |
| [0010](0010-stdio-transport-and-distribution.md) | stdio transport; distribute as source | Accepted |
| [0011](0011-local-credential-storage.md) | OS keychain for secrets; encrypted-file fallback | Accepted |
| [0012](0012-account-management-outside-mcp.md) | Account management via CLI, not MCP | Accepted |
| [0013](0013-bring-your-own-google-oauth-client.md) | Each user brings their own Google OAuth client | Accepted |
| [0014](0014-name-and-trademark-use.md) | Public name: *Multi-Gmail Connector for Claude* | Accepted |
| [0015](0015-cli-writes-the-claude-configuration.md) | The CLI writes Claude's configuration itself | Accepted |

Format: Context, Decision, Consequences (and Alternatives where useful).
