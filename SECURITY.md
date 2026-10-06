# Security policy

## Reporting a vulnerability
**Please don't open a public issue for security problems.**

Report privately through GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting). Include:
- what you found and where (file/line if possible);
- how to reproduce it;
- the impact you expect.

**Never include real tokens, client secrets, email content or personal data** in a report. Use fake values.

We aim to acknowledge reports within 7 days and to fix confirmed high-severity issues within 30 days. We'll credit you in the release notes unless you prefer otherwise.

## Supported versions
Only the latest release on the default branch gets security fixes during the 0.x series.

## Scope
In scope: this repository's code and documentation, including the OAuth flow, credential storage, log redaction, MCP tool output and email content handling.

Out of scope: vulnerabilities in Claude, Google services, Node.js or your operating system's keychain (report those to their vendors); attacks that require an already-compromised user account on the machine running the connector (documented in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)); prompt-injection behaviour of the model itself, unless this connector makes it worse than documented.

## If you think your tokens were exposed
1. Revoke the app at https://myaccount.google.com/permissions for each affected account.
2. Run `cmec uninstall`.
3. In Google Cloud Console, delete the OAuth client (or reset its secret) and create a new one.
4. Run `cmec setup` again.

The security design is described in [docs/SECURITY_DESIGN.md](docs/SECURITY_DESIGN.md).
