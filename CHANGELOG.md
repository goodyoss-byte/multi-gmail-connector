# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-10-06

First public release.

### Changed
- **Renamed** to *Multi-Gmail Connector for Claude* (package `multi-gmail-connector`).
  Existing installs keep their accounts: `config.json` is copied from the old
  directory on first run, and keychain entries are read from the previous
  service name and carried over.
- **Published to npm**, so installing is two commands and there is no cloned
  folder to keep: `npm install -g multi-gmail-connector` then `cmec setup`.
  Installing from source still works and is documented in the README.
- **Shorter commands.** `cmec add`, `cmec list`, `cmec fix`, `cmec remove`,
  `cmec label`, `cmec include`, `cmec reconnect` replace
  `npm run cmec -- accounts <command>`. The old `accounts <command>` form still
  works, and from a checkout every command works as `npm run cmec -- <command>`.
- **Search across accounts costs much less.** Message summaries are now fetched
  only as the merge consumes them, instead of fetching `max_results` for every
  account and discarding the surplus. A 25-result search over three accounts
  went from 75 `messages.get` calls (1,515 Gmail quota units) to 30 (615) —
  about 59% less; over two accounts, about 40% less. Look-ahead reads are
  cached, so paging to the next page does not re-read them.

### Added
- `cmec install` writes the server into Claude Desktop's `claude_desktop_config.json`
  and registers it with Claude Code, instead of printing JSON for you to merge
  by hand. Other servers in the file are preserved and the previous file is kept
  as `claude_desktop_config.json.backup`. `cmec claude-config` still prints it.
- `cmec setup` now also walks through the Google Cloud Console pages one at a
  time (`cmec google-setup` on its own), finds a `client_secret*.json` in your
  Downloads or Desktop folder, accepts a pasted client ID and secret instead of
  a file, and finishes by adding the connector to Claude.
- `cmec fix` checks every account and re-signs in only the ones that need it, in
  one pass — the weekly chore while an OAuth app stays in Google's Testing mode.
- `list_email_accounts` now reports `last_signed_in`, `days_since_sign_in` and
  `action_needed`, so Claude can warn you before a sign-in expires rather than
  after a search fails.
- A search that loses one account mid-page now keeps that account's place in the
  cursor, so retrying resumes it instead of skipping its remaining messages.

### Fixed
- `configDir()` built macOS and Linux paths with the host's path separator, so
  the non-native branches produced wrong paths (and failed CI on Windows).
- The in-process account cache reloaded `config.json` only when its mtime
  changed, so two writes inside the same millisecond looked like one: an
  account that had just been reconnected could still report
  `needs_reauth` until something else touched the file. The cache now also
  follows the config store's own write counter.
- CI ran `npm audit` with dev dependencies included, failing on advisories that
  never reach users. It now audits production dependencies, pins its GitHub
  Actions to commit SHAs, and checks that the npm package packs.

## [0.1.0] — 2026-09-27

Unreleased private build: read-only multi-Gmail MCP server over stdio, OAuth
with PKCE and loopback redirect, tokens in the OS keychain, five read-only
tools, and the architecture, security and privacy documentation.
