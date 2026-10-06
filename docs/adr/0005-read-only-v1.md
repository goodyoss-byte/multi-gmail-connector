# ADR-0005: V1 is read-only

- Status: Accepted (adapted for the local-first edition, see note)
- Date: 2026-09-27

> **Local-first edition note (2026-09-27):** Still applies unchanged: the local edition requests only `gmail.readonly` and exposes read-only tools.

## Context
Email content is attacker-controlled and ends up in Claude's context (prompt injection). Write actions (send, delete, modify) would turn an injected instruction into real damage. Write scopes also add verification burden. The owner's brief prefers read-only V1.

## Decision
- V1 requests only `gmail.readonly` and exposes only tools annotated `readOnlyHint: true`.
- Write tools are designed but not built (MCP_DESIGN.md §8): separate tool per action, `destructiveHint: true`, incremental per-account Google consent, and a two-phase prepare → out-of-band confirm → execute flow using `pending_actions`.
- Adding writes needs a separate owner approval (roadmap Phase 12).

## Consequences
- ✅ Injection can't make this connector send or delete mail.
- ✅ Tools can run without per-call prompts under Claude's read-only rules, which keeps the experience smooth.
- ❌ No drafting/sending from Claude through this connector in V1.
- ❌ Injection can still steer Claude to misuse *other* enabled connectors (THREAT_MODEL T1).
