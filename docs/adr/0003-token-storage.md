# ADR-0003: Envelope-encrypt provider tokens with per-connection data keys wrapped by Cloud KMS

- Status: Superseded by ADR-0011 (hosted design; preserved in the private paid-edition repository)
- Date: 2026-09-27

## Context
We store long-lived Google (and later Microsoft) refresh tokens that grant read access to entire mailboxes. The Workspace policy requires encryption at rest and key management. A database or backup leak must not expose usable tokens.

## Decision
- Per-connection random 256-bit **DEK**; tokens encrypted with **AES-256-GCM**, fresh 96-bit IV each time.
- **AAD** = `connection_id | user_id | provider | kms_key_version | field | token_generation`, so ciphertext can't be replayed in another row.
- DEK wrapped by a **Cloud KMS** symmetric key (software protection level, 90-day rotation); only the runtime service account can decrypt.
- Unwrapped DEKs cached in memory ≤ 5 minutes.
- Refresh serialized per connection (row lock); new refresh tokens stored atomically.
- Disconnect = revoke at provider + delete ciphertext and wrapped DEK (crypto-shred).
- Tokens never leave the server, never reach Claude, never logged.

## Consequences
- ✅ DB/backup theft alone yields nothing usable.
- ✅ Emergency kill: disable the KMS key version.
- ✅ Cheap: ≈ $0.06/key-version/month + $0.03 per 10,000 operations.
- ❌ KMS becomes a runtime dependency (latency, availability); mitigated by the DEK cache.
- ❌ A compromised running service can still decrypt; addressed later by splitting the vault into its own service (roadmap Phase 10).

## Alternatives rejected
- Storing tokens in Secret Manager (one secret per token): awkward for rotation at scale, per-version costs, no AAD binding.
- Column encryption with an app-held static key: the key would live next to the data.
- Cloud HSM: stronger, ≈ $1/key-version/month; kept as a later upgrade.
