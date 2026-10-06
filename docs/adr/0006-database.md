# ADR-0006: PostgreSQL (Cloud SQL) with row-level security

- Status: Superseded by ADR-0009 (no database in the local edition) (hosted design; preserved in the private paid-edition repository)
- Date: 2026-09-27

## Context
Tenant isolation and multi-account uniqueness are core requirements. We need relational constraints (foreign keys, partial unique indexes), transactional token refresh, and a second isolation layer in case application code misses a filter.

## Decision
- PostgreSQL 16 on **Cloud SQL**, private IP, IAM auth, automated backups + PITR.
- Schema per DATABASE.md; `FORCE ROW LEVEL SECURITY` on tenant tables with `SET LOCAL app.user_id` per transaction; runtime role isn't the owner.
- Personal mode: `db-f1-micro` (≈ $7.67/month, no SLA). Multi-user: HA and larger tiers.
- Kysely for typed queries; SQL migrations are the source of truth.

## Consequences
- ✅ Partial unique index expresses "each Google account once per user, many per user" exactly.
- ✅ RLS backstops IDOR bugs.
- ✅ `SELECT … FOR UPDATE` for safe refresh.
- ❌ Fixed monthly floor even when idle (unlike Firestore).
- ❌ Shared-core tiers are outside the Cloud SQL SLA.

## Alternatives rejected
- **Firestore:** no partial unique indexes or RLS; isolation would rest only on security rules/app code.
- **SQLite on a volume:** poor fit for Cloud Run's ephemeral instances.
- **External Postgres (Neon/Supabase):** acceptable cost-saving variant for personal use (see COST_ANALYSIS.md) but not the default.
