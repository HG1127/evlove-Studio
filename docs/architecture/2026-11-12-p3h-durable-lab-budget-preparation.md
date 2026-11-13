# P3-H · Durable Lab AI budget schema and server RPC adapter (implementation-only)

Date: 2026-11-12
Workspace: `D:\Downloads\evlove-studio-evolve-p0`
Branch: `codex/artifact-evolution-governance-p0`

## Scope actually implemented

1. Added a forward-only, service-role-only PostgreSQL Lab AI budget migration:
   - one immutable budget per Mission/Workflow control Job (at most 6 calls, USD 5 total, deadline at most 20 minutes);
   - one unique UUID and budget reservation per physical provider attempt, including retries;
   - atomic Job lock + budget row lock using the same transaction-scoped Job advisory lock as cancellation;
   - reported measured-cost settlement; **missing cost stays held and pauses further requests**;
   - cancellation never restores spent/unknown quota;
   - RLS on both tables, no anon/authenticated table/RPC access.
2. Added a server-only Lab RPC adapter. It validates isolated Lab project identity and a server-side secret before a PostgREST write. It never uses the browser BYOK key, does not log secrets and never retries POST.
3. Added focused adapter tests, static migration invariants and a rollback-only SQL fixture for disposable PostgreSQL.

## Not yet enabled or proven

- The migration is **not applied** to either production or Lab Supabase. No database schema is changed remotely in this phase.
- The adapter is intentionally **not yet wired into the AI gateway/Workflow mission dispatch**, which stays blocked by `LAB_DURABLE_AI_BUDGET_REQUIRED`. An RPC schema without runtime wiring is not a durable live-call control.
- This implementation alone does **not** establish live provider cost control. Before enabling multi-generation calls, verify provider-side hard spend cap, model-specific pricing/usage normalization, bounded input+output token cost, cancellation in-flight, and execute a **two-connection transactional race** on the actual isolated database.
- No live MiniMax generation or Judge call, no three-generation Mission, no Gate F pass, no production database/Vault mutation, no deployment or merge was performed by this phase.
- Saved generation and Judge MiniMax Vault roles are preserved. No new API key is required.

## Remaining execution path

1. Apply and verify this migration only on the dedicated isolated Lab data plane, after operator approval and readback of Lab project identity.
2. Run `supabase/tests/lab_ai_budget_integration.sql` in a disposable, fully migrated PostgreSQL database, plus a separate two-connection lock/cancellation test.
3. Add independently verified provider pricing, provider-side hard spend limit and mandatory budget reservation/settlement to every physical model HTTP/SDK attempt (no fallback when billing is unknown).
4. Attach the budget to a time-limited synthetic HTML Mission's Workflow control Job; cancel on timeout; keep Judge independent.
5. Only then permit a bounded real three-generation experiment; record model route IDs, token/cost evidence, exact artifact SHA-256 lineage, visible/hidden tests and Gate F.

This phase is a safe preparatory implementation, **not** a live-experiment acceptance result.
