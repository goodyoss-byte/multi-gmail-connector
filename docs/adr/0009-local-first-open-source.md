# ADR-0009: Change from a hosted multi-tenant service to a local-first open-source MCP server

- Status: Accepted (owner decision, 2026-09-27)
- Supersedes: ADR-0001, ADR-0003, ADR-0006, ADR-0007, ADR-0008 for this repository
- Date: 2026-09-27

## Context
The first design (ADRs 0001–0008) was a hosted service: a remote MCP server with its own OAuth authorization server, PostgreSQL, Cloud KMS and Cloud Run. For a hosted service, Google's restricted `gmail.readonly` scope requires brand verification plus an annual CASA security assessment once it has more than 100 users. The service would also hold many people's mailbox tokens, and it has a fixed monthly cost.

The owner wants a free edition that anyone can download and run, with minimal cost and maximum privacy, and to keep the option of a paid hosted product later.

## Decision
- This repository becomes the **free, local-first, open-source edition**: a stdio MCP server plus CLI that each user runs on their own computer, with their **own** Google Cloud project and OAuth client.
- Tokens stay on the user's machine in the OS keychain. We operate no servers and receive no user data.
- The hosted design is preserved unchanged in a separate private repository for a possible future managed edition. This repository has no runtime dependency on it.
- ADRs 0002 (stable provider identity), 0004 (provider abstraction) and 0005 (read-only V1) still apply, adapted to local use. ADRs 0001, 0003, 0006, 0007 and 0008 are superseded here.

## Consequences
- ✅ No infrastructure, no running cost, no central store of credentials or email.
- ✅ No Google verification or CASA for us: each user is the sole user of their own personal-use OAuth client.
- ✅ Much smaller attack surface: no public endpoints, no OAuth server, no database.
- ❌ Setup is more technical: each user creates a Google Cloud project and Desktop OAuth client and sees Google's "unverified app" screen once per account. A setup wizard and step-by-step guide reduce the friction.
- ❌ Works where local MCP servers work (Claude Desktop, Claude Code). claude.ai on the web and mobile need a remote server, which is the paid edition's role.
- ❌ Each installation's security depends on the user's own machine.
