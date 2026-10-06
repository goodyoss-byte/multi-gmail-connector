# ADR-0012: Manage accounts from the CLI, not through MCP tools

- Status: Accepted
- Date: 2026-09-27

## Context
The brief asks whether connect, disconnect, relabel and reconnect should be MCP tools. Connecting needs a browser OAuth flow. Disconnecting is destructive. Email content can contain prompt injection that tries to get Claude to call tools.

## Decision
- The MCP server exposes **only read tools**: `list_email_accounts`, `search_emails`, `get_email`, `get_thread`, `get_attachment`.
- Adding, reconnecting, relabelling, including/excluding and removing accounts is done in a terminal with `cmec list …` (and `cmec setup`).
- `list_email_accounts` and error results include the exact command to run, so Claude can tell the user what to do.

## Consequences
- ✅ A malicious email can't make Claude disconnect an account, change which accounts are searched, or start an OAuth flow that links an attacker's mailbox.
- ✅ The MCP server never needs to open a browser or a network port.
- ❌ The user switches to a terminal for account changes, which are infrequent.
- Revisit when Claude clients support URL-mode elicitation: a connect flow could then start from Claude, with confirmation in the browser.
