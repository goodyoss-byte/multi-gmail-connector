# Roadmap (local-first edition)

Status legend: ✅ done · 🔜 next · ⏳ later. Anything that needs the owner's Google account, repository visibility changes or publishing stops for explicit approval.

## ✅ Phase 0 — Research and hosted design
Preserved in the private paid-edition repository; superseded here by ADR-0009.

## ✅ Phase 1 — Local-first redesign
- **Deliverables:** ADR-0009…0013; architecture, OAuth, MCP, security, threat model, privacy and testing docs; Google Cloud setup guide.
- **Done when:** docs describe the local edition accurately and no hosted-only docs remain in this repository.

## ✅ Phase 2 — Core implementation (no real credentials needed)
- **Deliverables:** stdio MCP server with five read-only tools; Gmail provider; OAuth loopback + PKCE connect flow; OS-keychain and encrypted-file secret stores; account registry; token manager; content guard; rate limiter; redacting logger; CLI (`setup`, `accounts`, `set-client`, `claude-config`, `doctor`, `uninstall`, `serve`).
- **Tests:** 97 automated tests including the critical A/B isolation test and a stdio end-to-end test.
- **Done when:** `npm test` passes; `npm run build` produces a server Claude can launch.

## 🔜 Phase 3 — Real-account verification (needs the owner)
- **Objective:** Prove the full flow with real Google accounts on a real desktop.
- **Owner actions:** create a Google Cloud project and Desktop OAuth client (GOOGLE_CLOUD_SETUP.md), connect two or three Gmail accounts, add the server to Claude Desktop and/or Claude Code.
- **Tests:** RELEASE_CHECKLIST "Manual verification" section on macOS/Windows/Linux as available.
- **Done when:** "Search all my inboxes for …" returns correctly labelled results from each account in Claude; `doctor` passes; reconnect and remove work.

## ✅ Phase 4 — Public release (v0.2.0, 6 Oct 2026)
- Renamed to *Multi-Gmail Connector for Claude* (`multi-gmail-connector`), with config and keychain migration from the pre-1.0 name.
- Release checks: 113 tests green on Linux/macOS/Windows, production `npm audit` clean, dependency licences all MIT/BSD, working-tree secret scan clean, CI actions pinned to commit SHAs.
- Published from a fresh single commit, so the earlier hosted/SaaS design history stays in the private repository.

## 🔜 Phase 5 — Easier installation
- ✅ npm package (`npm install -g multi-gmail-connector`), so no clone, no build step and no folder to keep. Installing from source stays documented for people who want to read the code first.
- ✅ `cmec install` writes Claude Desktop's config and registers the server with Claude Code; `cmec setup` ends by doing both.
- ✅ Google Cloud walkthrough that opens each Console page, finds the downloaded client file, or accepts a pasted client ID and secret.
- ⏳ Claude Desktop Extension (`.mcpb`) packaging: manifest, sensitive config fields, and a connect flow that works without a terminal. Needs one bundle per OS because the keychain binding is a native module — otherwise the single-bundle fallback is the encrypted-file store, which is a weaker guarantee.

## ⏳ Phase 6 — More content types
- PDF text extraction (sandboxed worker, time and memory limits), then DOCX/XLSX.
- Optional per-account date or label restrictions ("only search INBOX for Business").

## ⏳ Phase 7 — Microsoft (Outlook.com / Microsoft 365)
- `GraphProvider`, MSAL-style desktop OAuth with loopback + PKCE, `Mail.Read`, `tid:oid` identity; same test suites against a fake Graph.

## ⏳ Phase 8 — Optional write features (separate approval)
- Drafts first (`gmail.compose` via a separate, explicit reconnect), then send with an out-of-band confirmation step. Not planned for the free edition until the read-only version has real-world use.

## Paid hosted edition
Tracked separately in the private repository. This edition must keep working without it.
