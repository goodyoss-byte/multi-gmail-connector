# Threat model (local edition)

Scope: the connector running on one user's computer, launched by Claude Desktop or Claude Code, reading that user's Gmail accounts. Controls are detailed in [SECURITY_DESIGN.md](SECURITY_DESIGN.md).

## Assets
Refresh tokens (long-lived mailbox read access) · OAuth client secret · email content passing through · the account list.

## Actors
**A1** Malicious email sender (most likely) · **A2** Malware running as the user · **A3** Another OS user on the same machine · **A4** Network attacker · **A5** Compromised dependency or impersonated package · **A6** A person with the user's unlocked computer.

## Threats
| # | Threat | Actor | Mitigations | Residual |
|---|---|---|---|---|
| T1 | **Prompt injection** in an email steers Claude | A1 | Read-only tools; no account-management tools; `content_notice`; hidden-text/invisible-char stripping; heuristic `injection_warning`; size caps | **Medium.** Claude may still be influenced, and other tools in the same session may act. See SECURITY_DESIGN §5. |
| T2 | Injection makes the connector connect an attacker's mailbox or disconnect one | A1 | Account management is CLI-only (ADR-0012) | Low |
| T3 | Results from account B shown as account A / wrong token used | bug | Provider bound to one account's token; refs carry the account id; tests check labels and which token touched which mailbox; mutation-tested | Low |
| T4 | Token theft from disk | A3, A6 | OS keychain; `config.json` holds no secrets and is `0600`; encrypted-file fallback | Low (keychain); Medium with the file fallback if the passphrase is in a readable config |
| T5 | Token theft by malware running as the user | A2 | None can fully stop same-user malware from asking the keychain; tokens are read-only; revoke via `accounts remove` or Google permissions | **Medium** (inherent to any local app) |
| T6 | Tokens leak into logs, errors or Claude's context | bug | Redaction layer; tokens never in tool output (tested); logs on stderr only | Low |
| T7 | OAuth code interception / CSRF on the loopback | A2, web page | PKCE S256, 256-bit state (constant-time), nonce, 127.0.0.1 only, Host check, one-shot, 5-min timeout | Low |
| T8 | Wrong Google account on reconnect silently swaps a mailbox | user error | `sub` must match; stray token revoked | Low |
| T9 | Malicious MIME/HTML/attachment crashes or exploits the parser | A1 | Part/depth/size limits; text-only extraction; no PDF/Office parsers; HTML never rendered; malformed-input tests | Low–Medium |
| T10 | Network MITM | A4 | HTTPS to Google only; Node TLS verification | Low |
| T11 | Supply-chain compromise or package impersonation | A5 | Four runtime deps, lockfile, `npm ci`, audit in CI, no `npx` hints, Dependabot | Medium (industry-wide) |
| T12 | Client secret exposure | A3, A5 | Keychain; downloaded JSON offered for deletion; `.gitignore` covers `client_secret*.json` | Low (Google treats Desktop secrets as non-confidential; exposure alone doesn't grant mailbox access) |
| T13 | Quota exhaustion | A1 via T1 | Per-account budget of 4,800 units/min; result caps | Low |
| T14 | Phishing via links in email | A1 | Real link hosts shown; SPF/DKIM/DMARC header surfaced | Medium (user judgement) |

## Summary
The dominant risk is **T1 prompt injection combined with other powerful tools** in the same Claude session, and **T5 same-user malware**, which affects every local credential store. Both are documented for users. Everything else is low after mitigation.
