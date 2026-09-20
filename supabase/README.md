# Supabase Production Data Layer

Supabase is the V1 production data platform:
- PostgreSQL: Mission / Job / Event metadata and versioned JSONB state
- Storage: source/evolved Artifacts and evidence files
- Realtime: UI projections
- Auth: deferred until requested

All production schema changes must be checked in under `supabase/migrations/`. Manual dashboard-only schema changes are not an accepted source of truth.
