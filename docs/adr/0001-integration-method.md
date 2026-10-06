# ADR-0001: Integrate with Claude as a remote MCP server (custom connector)

- Status: Superseded by ADR-0009 and ADR-0010 (hosted design; preserved in the private paid-edition repository)
- Date: 2026-09-27

## Context
The user wants Claude to search and read several of their own mailboxes. The options are Claude's built-in Gmail connector, Google's Gmail MCP server, a Claude skill, or our own MCP server added as a custom connector. Custom connectors (remote MCP by URL) are available on Free (one), Pro, Max, Team and Enterprise, and the same connector works in claude.ai, Desktop, mobile, Cowork and Claude Code.

## Decision
Build a **remote MCP server** (Streamable HTTP, MCP TypeScript SDK v2 `createMcpHandler`, serving spec 2026-07-28 and 2025-era clients) that Claude uses as a **custom connector**, with our own OAuth 2.1 authorization server and a web dashboard for managing mailboxes. A skill or plugin may later add usage guidance only.

## Consequences
- ✅ One connector, any number of mailboxes, consistent labelling.
- ✅ Works on every Claude surface that supports custom connectors.
- ❌ We operate a service that holds restricted-scope Google data, which brings Google verification and CASA for anything beyond personal use.
- ❌ We must implement and secure an OAuth AS.

## Alternatives rejected
- **Built-in Gmail connector:** one Google account per user (strongly implied; not explicitly documented).
- **Google Gmail MCP server:** Developer Preview, one identity per connector, tool set not stable.
- **Adding one connector per mailbox:** duplicate tool names, unclear if Claude allows the same URL twice (NOT VERIFIED).
- **Skill only:** skills run in a sandbox and aren't a credential store or authenticated backend.
