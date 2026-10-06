# ADR-0015: The CLI writes Claude's configuration itself

- Status: Accepted
- Date: 2026-10-06

## Context
Until now setup ended by printing a JSON block for the user to merge into `claude_desktop_config.json` by hand, plus a `claude mcp add` command to copy. Hand-merging JSON is the step most likely to go wrong for a non-technical user: a missing comma breaks every connector they have, the file lives in a different place on each OS, and a wrong absolute path fails silently with no feedback inside Claude. ADR-0012 keeps *account* management out of MCP for security reasons; that argument is about Claude not being able to change accounts, and says nothing about the installer touching Claude's own config file.

## Options considered
| Option | Result |
|---|---|
| **A. `cmec install` merges the entry itself (chosen)** | One command, correct paths, no JSON editing. Needs care: other servers must survive, and a corrupt file must not be made worse. |
| B. Keep printing the JSON | Zero risk to the user's file, maximum risk of a failed install. Kept as `cmec claude-config` for people who want it. |
| C. Ask Claude to configure itself through MCP | A tool that can rewrite Claude's own connector list is a privilege-escalation path from untrusted email content. Rejected outright. |

## Decision
Option A, with four guardrails:
1. Only `mcpServers.email` is written; every other key in the file is copied through untouched.
2. The previous file is written to `claude_desktop_config.json.backup` before any change.
3. A file that is not valid JSON is never rewritten — the command fails, says so, and prints the JSON instead.
4. If the entry is already correct, nothing is written at all.

Claude Code is registered by running `claude mcp add --scope user`, and only if that CLI is already on `PATH`; otherwise the command is printed. `cmec setup` asks before doing any of this, and `cmec claude-config` still prints the configuration for anyone who prefers to paste it.

## Consequences
- ✅ The install is one command; the "Claude doesn't see the tools" failure mode mostly disappears.
- ✅ Writes are additive, backed up, and refuse to run on a broken file.
- ❌ The connector now writes outside its own config directory. That is the installer's job only: nothing in the MCP server can reach this code path, and the tools stay read-only.
- Config paths are per-OS and could change if Claude Desktop moves them; `claudeDesktopConfigPath()` is one function with tests, and `cmec claude-config` remains the fallback.
