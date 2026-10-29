# Migrations

Evolution OS production schema is migration-only and append-only. Do not create or alter production tables manually without a matching migration.

## HTML Campaign atomic start migration · 2026-10-21

The forward-only `20261021130000_html_campaign_start_security_invariants.sql` adds the service-role-only `public.create_evolution_html_campaign_control(jsonb,boolean)` RPC. Apply and verify this migration **before** deploying the HTML start API that invokes it; deployment in the opposite order deliberately blocks new HTML Campaign starts instead of falling back to the unsafe generic Job RPC.

Before a production rollout, exercise `supabase/tests/html_campaign_start_integration.sql` on an **isolated, disposable PostgreSQL database** migrated with the same schema. That fixture encloses its data mutations in `BEGIN`/`ROLLBACK`. A separate two-connection transaction test establishes runtime lock behavior; static tests cannot prove PostgreSQL concurrency. Never run destructive test scaffolding on live Mission data. Compare the existing active Job/Run identities before and after migration and preserve the original evidence and Artifacts.

On 2026-10-23, `scripts/test-html-campaign-postgres.mjs` applied all 21 migrations on a local disposable PostgreSQL 16.15 + pgvector instance and passed both the rollback fixture and a real two-connection distinct-key race. The second connection waited 2,017 ms and returned `mission-active`; only one Job was inserted. This verifies the database logic with minimal platform DDL, not hosted Storage/Realtime or production migration. Production remains unapplied by this audit. See `docs/architecture/2026-10-23-evolution-proof-gates.md` for scope.

The script requires `EVOLUTION_ALLOW_DISPOSABLE_PG_TEST=1`, `EVOLUTION_TEST_PSQL` (absolute executable path), optional `EVOLUTION_TEST_PG_PORT` (default 55439), and a local ephemeral `PGPASSWORD`. It connects only to `127.0.0.1`, user `evolution_audit`, database `evolution_closed_loop_audit`, and rejects an existing nonempty application schema. Provision a dedicated empty test cluster/database first; do not point this script at an existing workspace database.

Current migration families cover Mission/Job/Event/Artifact persistence, Realtime, Organization Capabilities + pgvector/RBAC, Immutable Evidence Ledger, durable Release Approvals, Outcome samples, encrypted Server Vault, and the Organization Member Directory.

Security invariants:
- production data is server-mediated; browser clients do not receive service-role credentials;
- all Evolution business tables end with RLS enabled and PUBLIC/anon/authenticated table privileges revoked;
- SECURITY DEFINER RPCs explicitly revoke PostgreSQL PUBLIC execute privileges and grant only service_role;
- the evolution-artifacts bucket remains private and legacy anon Storage policies stay removed;
- *_security_invariants.sql must remain the final migration whenever new server-side tables or RPCs are added. migration-security-invariants.test.ts enforces this in CI.

Earlier migrations preserve historical bootstrap steps, including temporary internal-MVP grants. Do not infer the production security posture from an intermediate migration; the tail security-invariants migration defines the required final state.

## Cancellation fence final security tail · 2026-10-29

`20261029025416_control_mission_fence_security_invariants.sql` was generated with the installed Supabase CLI's `migration new` command. It reasserts the unchanged 2026-10-21 security snapshot after the cancellation-fenced CAS RPC, explicitly revokes its PUBLIC/anon/authenticated execution and grants service_role, and removes PostgreSQL's global PUBLIC default function execution. Earlier migrations remain byte-unchanged. The existing per-schema revocations, table RLS, append-only Event permissions, private Storage and Artifact retention permissions remain in the final snapshot.

This file is authored and statically checked only; it has not been applied to any database by this development task. Database catalog/default-ACL and role-access verification, along with an authorized isolated migration rehearsal, remain rollout prerequisites for the dedicated delivery owner. No production migration or deployment approval is granted by the static test result. See `docs/architecture/2026-10-29-restore-control-cancellation-security-tail.md` for scope.
