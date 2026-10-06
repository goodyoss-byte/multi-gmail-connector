# ADR-0010: Run as a local stdio MCP server, distributed as source

- Status: Accepted
- Date: 2026-09-27

## Context
Claude Code adds local servers with `claude mcp add … -- <command>`, and Claude Desktop runs local servers (today mainly as Desktop Extensions, `.mcpb`). The MCP spec says stdio servers should take credentials from the local environment rather than run an OAuth flow for the client. The MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.1.0) provides `serveStdio`, which serves both the 2026-07-28 protocol and the 2025-era `initialize` handshake that current Claude clients use.

## Decision
- Transport: **stdio only**, via `serveStdio(factory, { legacy: 'serve' })`. No network listener except the short-lived OAuth loopback in the CLI.
- stdout carries only MCP messages; all logs go to stderr.
- Distribution for V1: **clone + `npm install` + `cmec setup`**. `npm install` builds via the `prepare` script. `cmec claude-config` prints ready-to-paste configuration with absolute paths (`process.execPath` and the built `dist/cli.js`), so Claude Desktop doesn't depend on `PATH`.
- Command hints use the local script (`cmec …`), never `npx <name>`: the package isn't published, and `npx` would fetch an unrelated package from the registry.
- Later: publish to npm and/or ship a `.mcpb` Desktop Extension once the connect flow works from within Claude Desktop.

## Consequences
- ✅ No ports, no TLS, no OAuth server, no hosting.
- ✅ Works with Claude Code and Claude Desktop on macOS, Windows and Linux.
- ❌ Not usable from claude.ai on the web or on mobile (those need a remote server).
- ❌ Users need Node.js ≥ 22 and a terminal for setup.
