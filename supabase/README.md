# Supabase Production Data Layer

Supabase is the V1 production data platform:
- PostgreSQL: Mission / Job / Event metadata and versioned JSONB state
- Storage: source/evolved Artifacts and evidence files
- Realtime: UI projections
- Auth: deferred until requested

All production schema changes must be checked in under `supabase/migrations/`. Manual dashboard-only schema changes are not an accepted source of truth.

## Production migration automation

`.github/workflows/supabase-migrations.yml` validates migration/security invariants on every relevant PR/push. On `main`, it can also apply pending migrations using Supabase CLI `2.115.0` with a dry-run before and after the write.

Automatic production DB deployment requires these GitHub `production` Environment or Repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`

If any credential is missing, validation still runs but the workflow explicitly reports that production deployment was skipped; it never falls back to browser/publishable credentials. Vault values are not synchronized by this workflow (`--skip-vault`).
