# ADR-0013: Each user brings their own Google OAuth client

- Status: Accepted
- Date: 2026-09-27

## Context
Reading Gmail needs an OAuth client in a Google Cloud project. Google says installed (Desktop) apps "cannot keep the client_secret confidential", so a shared client secret shipped in the repository wouldn't be secret. More importantly, a shared client would make us the developer of one restricted-scope app used by everyone. That brings Google verification plus an annual CASA assessment, and a 100-user lifetime cap until then.

## Options considered
| Option | Result |
|---|---|
| **A. User creates their own Desktop OAuth client (chosen)** | No verification for us; each user is the sole user of a personal-use app. About 10 minutes of setup; an "unverified app" screen once per account. |
| B. Ship our client ID/secret in the repo | Violates the "don't distribute our secret" rule; makes us responsible for everyone's consent screen; triggers verification and CASA; hits the 100-user cap. Rejected. |
| C. Our hosted token broker | That is the paid, hosted edition. It contradicts "we receive no tokens". Rejected here. |
| D. OAuth device flow | Google's limited-input device flow supports only a restricted set of scopes; whether it allows `gmail.readonly` is **NOT VERIFIED** in this pass (believed not). Not adopted. |
| E. Google's own Gmail MCP server | Developer Preview, one account per connector. Not multi-account. |

## Decision
Option A. The setup wizard imports the downloaded client JSON file (Desktop type only), stores the client ID in `config.json` and the secret in the keychain, and offers to delete the downloaded file. `docs/GOOGLE_CLOUD_SETUP.md` walks through every console step.

## Consequences
- ✅ No shared credentials, no central point of failure, no verification cost for the project.
- ✅ Each user controls, and can revoke, their own project.
- ❌ The most technical part of installation. The guide and wizard exist to make it manageable.
- A simpler path would need Option C (paid edition) or a Google-verified shared client; both are out of scope for the free edition.
