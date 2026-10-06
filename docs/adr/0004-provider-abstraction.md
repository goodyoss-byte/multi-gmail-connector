# ADR-0004: One EmailProvider interface with per-provider adapters, in a modular monolith

- Status: Accepted (adapted for the local-first edition, see note)
- Date: 2026-09-27

> **Local-first edition note (2026-09-27):** Still applies, simplified: one `EmailProvider` interface (`src/providers/types.ts`) with a Gmail adapter; no separate services.

## Context
Gmail comes first; Microsoft Graph follows. The two differ in query syntax (Gmail `q` vs KQL `$search`), threading, labels vs folders, quotas and token rotation. Tools and results must look the same to Claude regardless of provider.

## Decision
- Define `EmailProvider` (search, getMessage, getThread, getAttachment, capabilities, estimateCost) and a normalised model (`EmailSummary`, `EmailMessage`) tagged with account metadata; see EMAIL_PROVIDER_DESIGN.md.
- Structured search filters translated per adapter; raw Gmail syntax accepted for Gmail only.
- Adapters receive a `ConnectionContext` whose `getAccessToken()` is bound to one connection — an adapter can never pick a token by itself.
- V1 ships as one deployable service with enforced module boundaries (lint rules: only the vault imports KMS; only adapters call provider APIs).

## Consequences
- ✅ Adding Microsoft is an adapter plus a connect flow, no tool changes.
- ✅ Shared contract tests across providers.
- ❌ Lowest-common-denominator features; provider-specific extras need capability flags.
- ❌ The monolith holds decrypt rights; a later vault split is planned.
