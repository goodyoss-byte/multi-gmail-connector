# ADR-0011: Keep refresh tokens and the OAuth client secret in the OS keychain

- Status: Accepted
- Date: 2026-09-27

## Context
A Gmail refresh token grants long-lived read access to a whole mailbox. It must never sit in plaintext files, the repository, logs or Claude's context. Operating systems provide secure credential stores; from Node, `@napi-rs/keyring` 2.1.0 wraps macOS Keychain, Windows Credential Manager and Linux Secret Service with prebuilt binaries (`keytar` is no longer maintained). Headless Linux, WSL and containers often have no Secret Service.

## Decision
- **Default: OS keychain.** Service name `multi-gmail-connector`; entries `google-client-secret` and `refresh-token:<account id>`. Each entry holds one small value (fits Windows' per-credential size limit).
- **Access tokens are never persisted**; they live in process memory and are refreshed on demand.
- **`config.json` holds no secrets.** It is written atomically with mode `0600` in a `0700` directory. Both load and save refuse any config that contains credential-shaped values.
- **Opt-in fallback: encrypted file** (`secrets.enc.json`) for machines without a keychain. AES-256-GCM per entry, key from scrypt (N=2^15, r=8, p=1) over `CMEC_SECRET_PASSPHRASE` (≥ 16 characters), entry name bound as AAD. It must be chosen explicitly during setup.
- Setup runs a write/read/delete probe and refuses to continue if no secure store works. It never falls back silently to plaintext.

## Consequences
- ✅ Tokens are protected by the same mechanism as browser and OS passwords.
- ✅ Other local users can't read them; backups of the config file contain nothing sensitive.
- ❌ Malware running as the same OS user can still ask the keychain for them (true of any local credential store). Documented in THREAT_MODEL.md.
- ❌ The encrypted-file fallback is weaker: the passphrase has to be in the MCP server's environment, which usually means in the Claude config file. It protects against copied files and backups, not against local malware.
