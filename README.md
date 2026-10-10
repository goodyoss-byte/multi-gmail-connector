# Multi-Gmail Connector for Claude

[![M8ven Score](https://m8ven.ai/badge/mcp/goodyoss-byte/multi-gmail-connector)](https://m8ven.ai/mcp/goodyoss-byte/multi-gmail-connector?s=readme)

**Free · Local-first · Open source · Read-only**

Let Claude search and read **several Gmail accounts at once** (personal, business, accounting…) from Claude Desktop or Claude Code. Every result tells you which account it came from.

> "Search all my connected inboxes for my Emirates flight confirmation."
> → *Found in **Personal** (personal@gmail.com): "Your Emirates flight confirmation EK202", 3 Sep.*

It runs **on your own computer**. You use **your own** Google credentials, and your tokens stay in your operating system's keychain. The authors run no server and never see your passwords, tokens, emails or searches.

> **Status: first public release (v0.2.0).** The code and its 113 automated tests are green on Linux, macOS and Windows in CI, and the connector has been in daily use on Windows with two Gmail accounts. Real-account setup on macOS and Linux has not been walked through yet — if something there is wrong, please open an issue.

---

## Contents
[What it does](#what-it-does) · [Supported environments](#supported-environments) · [Privacy](#privacy-model) · [Security](#security-model) · [Install](#install) · [Google Cloud setup](#google-cloud-setup) · [Multiple accounts](#connecting-multiple-gmail-accounts) · [The weekly re-sign-in](#the-weekly-re-sign-in) · [Commands](#commands) · [Example prompts](#example-prompts) · [Troubleshooting](#troubleshooting) · [Uninstall](#uninstall-and-revoking-access) · [Limitations](#limitations) · [Roadmap](#roadmap)

## What it does
- Connects any number of Gmail accounts (up to 25) under one Claude connector.
- Gives Claude five **read-only** tools:

| Tool | What Claude can do |
|---|---|
| `list_email_accounts` | See which accounts are connected (label, address, status, when each was last signed in) |
| `search_emails` | Search one account, several, or all of them; results are merged newest-first and labelled |
| `get_email` | Read one email as plain text (length-limited) |
| `get_thread` | Read a conversation (newest messages, length-limited) |
| `get_attachment` | Read text attachments (TXT, CSV, Markdown, calendar, HTML, JSON) |

It **cannot** send, reply, forward, delete, archive, move, label, draft, or mark emails read/unread. Google is only asked for the `gmail.readonly` permission.

## Supported environments
| | Supported |
|---|---|
| Claude Desktop | ✅ `cmec install` writes the config for you |
| Claude Code | ✅ `cmec install` registers it (user scope) |
| claude.ai on the web / mobile | ❌ They need a hosted server; this edition is local-only |
| Email providers | Gmail and Google Workspace mail. Outlook/Microsoft 365 is planned |
| OS | macOS, Windows, Linux (a desktop keychain is required, or the encrypted-file fallback) |
| Runtime | Node.js 22 or newer |

## Privacy model
- Runs locally; there is **no server and no telemetry**.
- Your Google OAuth client, refresh tokens and settings stay on your machine.
- Email content goes only from Google to Claude, and only when Claude calls a tool in your conversation.
- Nothing is cached to disk except the non-secret account list (`config.json`).

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Security model
- **Tokens in the OS keychain** (macOS Keychain, Windows Credential Manager, Linux Secret Service). They are never stored in plaintext, never logged, and never given to Claude.
- **Minimum permission:** `gmail.readonly`, plus `openid email` to identify each account.
- **OAuth best practice:** loopback redirect on 127.0.0.1, PKCE (S256), state and nonce checks, ID-token validation.
- **Accounts are identified by Google's permanent account id**, not by email address.
- **Email is treated as untrusted:** hidden HTML text and invisible characters are removed, suspicious "instructions to the AI" are flagged, and output is size-limited.
- **Account changes happen only in your terminal**, never through Claude.

> ⚠️ **Prompt injection:** an email can contain text designed to manipulate an AI. This connector is read-only and labels email content as untrusted, but no filter catches everything. Be careful combining email search with other tools that can send data or take actions in the same Claude session, and keep approval prompts on for those tools. See [docs/SECURITY_DESIGN.md](docs/SECURITY_DESIGN.md#5-prompt-injection).

## Install
You need [Node.js 22+](https://nodejs.org/) and a Google account. Two commands:

```bash
npm install -g multi-gmail-connector
cmec setup
```

`cmec setup` is the whole installation: it checks Node.js and your keychain, walks you through the Google Cloud pages one at a time, imports your OAuth client, connects your accounts, tests Gmail access, and **writes the configuration into Claude Desktop and Claude Code for you**. Restart Claude Desktop at the end and the `email` tools are there.

Later, `npm update -g multi-gmail-connector` upgrades it.

<details>
<summary><b>Or install from source</b> — to read the code before running it, or to contribute</summary>

```bash
git clone https://github.com/goodyoss-byte/multi-gmail-connector.git
cd multi-gmail-connector
npm install
npm run build     # npm 11+ no longer runs the build itself
npm link          # optional: puts the `cmec` command on your PATH
cmec setup
```

If you skip `npm link`, every `cmec <command>` in this README is `npm run cmec -- <command>` instead, run from this folder. Keep the folder: a source install launches from it, so moving or deleting it breaks the connector. A global install has no such folder.
</details>

## Google Cloud setup
You need your own (free) Google Cloud project with the Gmail API and a **Desktop app** OAuth client. `cmec setup` opens each page in order and waits for you; `cmec google-setup` runs just that walkthrough again. The written version, with screenshots of what to expect, is in **[docs/GOOGLE_CLOUD_SETUP.md](docs/GOOGLE_CLOUD_SETUP.md)**.

1. Create a Google Cloud project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen (External, Testing mode; add your Gmail addresses as test users under Audience).
4. Create an OAuth client of type **Desktop app** and download its JSON.
5. No redirect URIs are needed.
6. Setup finds the downloaded file in your Downloads folder, or you can paste the client ID and secret. It is stored in your keychain and the file can then be deleted.

Why not a shared client? A shared one would put the project's credentials in every copy of the code and require Google's paid security assessment, because Gmail read access is a *restricted* scope. Your own client keeps you in control. See [ADR-0013](docs/adr/0013-bring-your-own-google-oauth-client.md).

## Connecting multiple Gmail accounts
```bash
cmec add --label Personal
cmec add --label Business
cmec add --label Accounting
cmec list
```
Each command opens your browser; pick a different Google account each time. Because the app is your own unverified app, Google shows **"Google hasn't verified this app"** once per account. Choose **Advanced → Go to … (unsafe)**, then make sure **"Read your email"** is ticked.

## The weekly re-sign-in
While your OAuth app stays in **Testing** mode, Google expires its sign-ins after **7 days**. That is Google's rule, not this connector's. Two things make it painless:

- `cmec fix` checks every account and re-signs in only the ones that need it, in one pass.
- `list_email_accounts` reports how long ago each account was signed in, so Claude can warn you *before* a search fails.

Leaving Testing mode removes the weekly expiry, but Google's **Publish app** button needs an application home page, a privacy policy and an authorised domain you own — so for most personal installs, `cmec fix` once a week is the simpler trade. See [docs/GOOGLE_CLOUD_SETUP.md](docs/GOOGLE_CLOUD_SETUP.md).

## Commands
```bash
cmec setup                     # everything: Google client, accounts, and add it to Claude
cmec add [--label NAME]        # connect another account
cmec list                      # show accounts, status and when each was last signed in
cmec fix                       # check everything and renew whatever expired
cmec install                   # (re-)write the Claude Desktop / Claude Code configuration
cmec label Business "Company"  # rename
cmec include Accounting off    # leave out of "search all"
cmec reconnect Personal        # re-authorise one account
cmec remove Accounting         # revoke at Google + delete the stored token
cmec doctor                    # check everything (never shows email content)
cmec claude-config             # print the configuration instead of writing it
cmec uninstall                 # revoke everything and delete all local data
```
New accounts you connect later appear without restarting Claude.

## Example prompts
- "Search all my connected inboxes for my Emirates flight confirmation."
- "Check all my inboxes for unread emails from this week that look important. Group them by account."
- "In my Business account, find invoices from Acme since 1 July and total the amounts from the CSV attachments."
- "Which of my accounts received the password-reset email from my bank?"
- "Show me the whole thread about the office lease."

## Troubleshooting
| Problem | Fix |
|---|---|
| `Secret storage is not available` | Linux: install/unlock GNOME Keyring or KWallet (`secret-tool` should work). Headless/WSL: use the encrypted-file store; see [SECURITY_DESIGN.md §2](docs/SECURITY_DESIGN.md#2-what-is-stored-where). macOS/Windows: unlock your login keychain or credential manager. |
| "This is a Web application client" | Create a **Desktop app** OAuth client instead. |
| Browser doesn't open | Copy the printed URL into your browser. The listener waits 5 minutes. |
| "Access blocked" / `admin_policy_enforced` on a work account | Your Google Workspace admin blocks unverified apps; ask them to allow it. |
| "Google did not grant read access" | Reconnect and tick **"Read your email"** on the consent screen. |
| Account shows `needs_reauth` | `cmec fix`. In Testing mode this is expected every 7 days. |
| Claude doesn't see the tools | `cmec install`, then quit and reopen Claude Desktop. Check Claude's MCP logs if it still doesn't appear. |
| `PROVIDER_RATE_LIMITED` | Wait the given number of seconds; ask for fewer results. |
| Anything else | `cmec doctor`, then open an issue (without personal data). |

## Uninstall and revoking access
```bash
cmec uninstall                 # revokes every account at Google, deletes keychain entries and config
claude mcp remove email        # Claude Code (or remove "email" from claude_desktop_config.json)
npm uninstall -g multi-gmail-connector        # or `npm unlink -g multi-gmail-connector` for a source install
```
You can also revoke access any time at https://myaccount.google.com/permissions, and delete your Google Cloud project in the Console. Details: [GOOGLE_CLOUD_SETUP.md §10–11](docs/GOOGLE_CLOUD_SETUP.md#10-revoke-access).

## Limitations
- Read-only; no sending or organising mail.
- Gmail only for now (Outlook planned).
- Claude Desktop and Claude Code only; not the web or mobile apps.
- Text attachments only (no PDF/Office text extraction yet).
- Search uses Gmail's own search; results per call are capped at 25 (ask for "more results" for the next page).
- Setup needs a terminal and a Google Cloud project.
- Prompt-injection detection is heuristic (see above).

## Roadmap
PDF and Office attachment text → a drag-and-drop Claude Desktop extension (`.mcpb`) so no terminal is needed → Gmail labels as a filter → Outlook / Microsoft 365. See [docs/IMPLEMENTATION_ROADMAP.md](docs/IMPLEMENTATION_ROADMAP.md). A hosted edition may exist in future for people who don't want to run anything locally; this edition will keep working on its own.

## Documentation
[Architecture](docs/ARCHITECTURE.md) · [Diagrams](docs/ARCHITECTURE_DIAGRAMS.md) · [OAuth](docs/OAUTH.md) · [MCP tools](docs/MCP_DESIGN.md) · [Provider design](docs/EMAIL_PROVIDER_DESIGN.md) · [Security design](docs/SECURITY_DESIGN.md) · [Threat model](docs/THREAT_MODEL.md) · [Privacy](docs/PRIVACY.md) · [Testing](docs/TESTING.md) · [Decisions (ADRs)](docs/adr/README.md) · [Research notes](docs/research/RESEARCH_NOTES.md) · [Changelog](CHANGELOG.md)

## Contributing and security
See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in public issues.

## License
Copyright (C) 2026 goodyoss-byte

This program is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License, version 3** (AGPL-3.0-only), as published by the Free Software Foundation. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

In short: you can use, study, change and share it for free. If you distribute a modified version, **or offer a modified version to others as an online service**, you must make your full source code available under the same licence. Running it privately on your own computer carries no obligations.

Not affiliated with, endorsed by, or sponsored by Anthropic or Google. "Claude" is a trademark of Anthropic, PBC and "Gmail" and "Google" are trademarks of Google LLC; both are used here only to say what this software works with.
