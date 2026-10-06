# ADR-0014: Public name is "Multi-Gmail Connector for Claude"

- Status: Accepted
- Date: 2026-10-06

## Context
The project was built privately as *Claude Multi-Email Connector* (`claude-multi-email-connector`). Publishing it means putting that name on a public repository, an npm package and a config directory, where it reads as a product name led by someone else's trademark. Anthropic's [trademark guidelines](https://www.anthropic.com/legal/trademark-guidelines) allow their marks only as expressly permitted and never in a way that implies sponsorship, endorsement or affiliation; "Gmail" and "Google" are Google LLC's marks under similar terms. Renaming after publication would mean a dead repository URL, a stranded npm name and broken install instructions in anything that had linked to it.

## Options considered
| Option | Result |
|---|---|
| **A. "Multi-Gmail Connector for Claude", package `multi-gmail-connector` (chosen)** | Reads as compatibility ("for Claude"), not as a Claude product. The npm name carries no mark at all. Says plainly what it does. |
| B. Keep *Claude Multi-Email Connector* | Leads with another company's mark in a product-name position, which is the construction most likely to draw a complaint; also the vaguer description ("multi-email" when it is Gmail-only). Rejected. |
| C. A coined name with no marks (e.g. "Mailfan") | Safest, but nobody searching for a Claude Gmail connector would find it, and it hides what the project does. Rejected. |

## Decision
Option A. The product name is *Multi-Gmail Connector for Claude*; the npm package, repository, config directory and keychain service are all `multi-gmail-connector`. "Claude", "Gmail" and "Google" appear only to describe what the software works with, with a disclaimer of affiliation in the README, and no Anthropic or Google logos, wordmark styling or brand colours are used anywhere.

## Consequences
- ✅ Nominative, descriptive use; no implied endorsement; nothing to rename later.
- ✅ The MCP server still registers under the key `email`, so what users type to Claude is unchanged.
- ❌ Existing installs point at the old config directory and keychain service. `src/config/migrate.ts` copies `config.json` across on first run and `KeyringSecretStore` reads the previous service name and carries entries over, so no one has to reconnect. Both fallbacks can be deleted once the pre-1.0 build is out of circulation.
