# Backend Capability Assessment and Delivery Plan

Assessment date: 2026-09-24

## Current capability

The repository already has a substantial production backend. The target composition is Nitro routes on Vercel Functions, durable Vercel Workflows, and Supabase for production state. The main implemented areas are:

| Area | Implemented capability | Current boundary |
| --- | --- | --- |
| Production data plane | Supabase-backed Mission, Job, Event, Artifact stores; revision CAS for Missions; monotonic Job generation/state RPCs; append-only Events; Realtime adapter | Server configuration and identity must be available; Auth is explicitly deferred in V1 rules |
| Durable execution | Evolution Mission and source-parse Workflows; run-to-Job generation binding; cancellation and scheduled-run controls | Several newly added generic Harness routes still call request-scoped code directly rather than starting a durable Workflow |
| Artifact and source intake | Private Storage adapter, source parser, parse jobs, Artifact metadata/hash binding | Blob, metadata, Event, and Evidence writes still need a recovery/reconciliation contract |
| Evidence and acceptance | Immutable signed Evidence Ledger, exports and verification; durable validation Events; artifact acceptance/release evidence in Core/Harness | Validation supports deterministic hash/size/text checks; broader execution and visual checks remain capability-gated |
| Release and integrations | Git/Connector targets, staged candidate isolation, release approvals, deploy/reconcile/rollback, provider health and outcome telemetry | Provider support remains capability-gated; missing external evidence must remain unverified |
| Governance and operations | Actor RBAC, organization membership checks, server-only credentials, security/capability/readiness endpoints, migration checks | User login is not part of the current V1 baseline; production identity depends on a trusted actor assertion or protected internal deployment |

The active working tree already contained uncommitted lifecycle work across artifact, evidence, validation, checkpoint, and Harness routes. This turn continued that work in place.

## Confirmed gaps

1. **Validation evidence atomicity:** validation records persist in the immutable Event Store and support idempotent retries. Writing the follow-on signed Evidence Ledger record is a separate operation; retrying the same idempotency key completes it.
2. **Artifact lifecycle atomicity:** blob bytes and metadata persist through the Artifact Store; registration and evidence/Event writes remain separate operations. The Artifact reconciliation API now replays missing audit writes from stored bytes after checking identity and hash. Binary compatibility uploads have a 20 MiB request cap; metadata failures retain bytes for recovery. Tombstone-driven cleanup for a Storage delete failure is implemented in code and awaits the new database migration and real Storage verification.
3. **Lifecycle consistency:** Job creation, transitions, Workflow Job Store writes, cancellation, and checkpoint writes now use transactional RPCs with Events. Signed Evidence is still a separate write and relies on deterministic retry/reconciliation.
4. **Durable Harness entry point:** `harness-execute` now starts the durable Mission Workflow and returns a Job/run identity. `harness-run` only prepares execution context.
5. **Boundary contracts:** Artifact registration, Harness preparation, and Job requests now validate inputs with shared Zod contracts. Binary Artifact upload and signed GitHub/Connector webhooks enforce byte limits while streaming, including chunked requests without `Content-Length`. Other compatibility routes still need a systematic response-contract review before they become stable clients of the backend.
6. **Public multi-user authentication:** current governance checks are meaningful server-side controls, but user login/session ownership is intentionally deferred by the V1 architecture rules. Do not expose a public multi-tenant product until an Auth and row-ownership design is selected.

## Delivery plan

### P0 — Truthful validation (complete)

- Represent unsupported validation as `unverified`.
- Only report a concrete missing Artifact as failed; Artifact existence alone cannot pass validation.
- Do not accept a checkpoint when its validation is unverified.
- Persist versioned validation results in append-only EvolutionEvents and retrieve them after restarts.

**Acceptance:** missing Artifact is failed with a reason; existing Artifact without an executable check is unverified; neither API state nor checkpoint evidence says passed without a real check bound to the exact Artifact hash.

### P1 — Recoverable Artifact and validation lifecycle (implemented in code)

- Added Zod request/result contracts for Artifact registration and Validation.
- Artifact registration now stores Mission/Job/type metadata and server-computed SHA-256 with the private blob. An existing Artifact ID cannot be rebound across Missions or reused for different bytes.
- Validation records persist in immutable Event payloads; GET reads the Event Store.
- Implemented SHA-256, minimum/maximum byte length, and UTF-8 text-presence checks with explicit per-check evidence. Unsupported/no checks remain unverified.
- Checkpoint acceptance now requires a persisted passed result carrying the exact Artifact hash.
- Validation POST accepts an idempotency key; a retry with the same key and request returns the persisted result, while reusing the key for another request returns a conflict.

Artifact reconciliation now validates stored bytes and metadata before replaying deterministic Event and Evidence writes. Validation POST retries its persisted Event result and deterministic Evidence record using the same idempotency key. Focused tests cover validation and Artifact repair behavior.
The legacy JSON Artifact POST now delegates to the bounded registration route, so it cannot bypass the same immutable ID and metadata checks.

**Acceptance:** a restarted function can retrieve validation; metadata/hash drift is rejected; only a passed check over the stored hash can accept a checkpoint. Registration audit failures can be repaired using the stored Artifact; validation audit failures can be retried with the same idempotency key.

### P2 — Atomic Job and Checkpoint lifecycle (implemented in code)

- Define allowed Job transitions and reject illegal jumps, stale generations, and terminal rewrites at the contract/service boundary.
- Add idempotent Job creation keyed by a caller-independent operation key.
- Ensure state transitions and authoritative Events commit together through a database RPC/transactional write path.
- Use Mission revision CAS for checkpoint mutations and record actor, reason, and exact evidence binding.

**Acceptance:** retrying a transition does not duplicate events or regress state; an Event write failure cannot leave a success state without its audit event; concurrent checkpoint writes return a conflict instead of overwriting each other.

The migration `20260924100000_job_lifecycle_security_invariants.sql` defines the RPCs and re-applies the security tail. It was applied to the linked `Evlove-Studio / main PRODUCTION` database through the Supabase SQL Editor in one transaction with its migration-history row. The recorded SQL, normalized for CRLF, has SHA-256 `9973e30427385b36047817ef4ddc487ac598a0657f462b115b512aa05b1b99a0`, matching the repository file. `supabase/tests/job_lifecycle_integration.sql` passed both inside the migration dry run and independently after deployment, each wrapped in `BEGIN`/`ROLLBACK`. Post-run checks found no test rows, confirmed the RPCs and service-only permissions, Job RLS, and the private Artifact bucket. Static security and mocked RPC tests also pass. The local CLI was unavailable because the account reached its personal-access-token limit and the supplied database password was rejected; the Dashboard path completed the database verification without changing credentials.

### P3 — Durable Harness orchestration (entry point connected)

- Route production Harness execution through Vercel Workflow start, not a long API invocation.
- Create/bind an EvolutionJob before starting; persist run id against the exact generation; cancel orphan runs on binding conflict.
- Move progress, heartbeat, checkpoint, failure, and finalization updates into bounded Workflow steps.
- Keep planner and execution behavior dependency-injected through Harness ports.

**Acceptance:** API returns a durable Job/run identity; execution survives function restarts; cancellation and retries are generation-safe; terminal Job/Event state reflects the Workflow result.

The legacy `harness-execute` route now delegates to the existing durable Mission Workflow start handler. Finalization emits a completion Event only when the persisted Control Job is completed, preserves terminal cancellation, and records nonterminal results as progress. Cancelling a run that has already completed no longer invents a completed Job; an unresolved result returns `409` and remains visible to reconciliation. Workflow step behavior and operational recovery remain under P5.

### P4 — Production identity and tenant ownership gate

- Before public multi-user launch, select Supabase Auth/session verification and an organization/Mission ownership model.
- Scope Mission, Job, Artifact, Event, Evidence, and signed download access to the authenticated workspace.
- Keep service-role credentials server-only; preserve server-side RBAC and organization membership checks.

**Acceptance:** cross-workspace reads and writes are denied in both API and database enforcement; readiness reports identity/data ownership as blocked until configured.

### P5 — End-to-end operational readiness (in progress)

- Add recovery/reconciliation for non-terminal Jobs whose Workflow run is missing or stale.
- Add bounded payload/Artifact quotas, retention rules, and actionable failure telemetry.
- Exercise the full chain from Mission creation through exact-Artifact validation, release, outcome ingestion, and next-cycle learning using real configured adapters.
- Update readiness to distinguish code-ready, configured, and production-evidenced capabilities.

**Acceptance:** the production readiness report has no false-ready capability; the same accepted Artifact hash is used through validation and delivery; capability gaps remain unverified.

A bounded Workflow Job reconciliation API now scans active Parse and durable Control Jobs without unrelated Job starvation. It reports runs that are unbound, missing, terminal, or have a stale heartbeat. Optional repair closes Jobs with a confirmed missing/failed/cancelled run or a long-unbound control Job. A completed Mission Workflow can settle a running Job only from a persisted return value that passes the Workflow result contract and matches the exact Mission and Control Job IDs; unknown or nonterminal results remain issues. Vercel Cron invokes a bounded daily repair scan through a `CRON_SECRET`-protected endpoint once deployed. V1 has no automated deletion of Events, signed Evidence, or accepted Artifacts. Explicit Artifact deletion is blocked for Mission-bound or Evidence-referenced objects; only unbound, unreferenced scratch objects can be removed. The `20260924113000_artifact_identity_security_invariants.sql` migration freezes Artifact identity and enforces both retention checks in PostgreSQL. It was applied to `Evlove-Studio / main PRODUCTION` through the Supabase SQL Editor in one transaction with its migration-history row. The recorded SQL, normalized for CRLF, has SHA-256 `3b09161d4551fa8b8290d406e836689bf2a2151601325f5b04cf509b1f21b92c`, matching the repository file. The migration dry run and the independently rerun `supabase/tests/artifact_identity_integration.sql` passed under `BEGIN`/`ROLLBACK`; post-run checks found no test rows and confirmed the identity trigger, Evidence lookup index, Artifact RLS, and private bucket. The adapter now deletes scratch metadata before Storage bytes, so a database veto preserves the blob. New uploads use a hash and unique generation in their paths; a stale upload cannot reuse a deleted Artifact path or revive its deleted metadata row.

The follow-up `20260924120000_artifact_evidence_retention_security_invariants.sql` migration closes the concurrent Evidence append/Artifact delete gap under the production data plane's default READ COMMITTED isolation. Both triggers take the same transaction-scoped advisory lock per Artifact ID. A successful scratch deletion records a durable ID tombstone; later Evidence references and Artifact ID reuse are rejected. Existing external hash references remain allowed. It was applied to `Evlove-Studio / main PRODUCTION` in a transaction with its migration-history row. The recorded SQL, normalized for CRLF, has SHA-256 `272adf4c50f4f581daea213e1d7bc9696fb0fa16a8916a50bb90c555b69e0550`, matching the repository file. Both the migration-only dry run and a migration-plus-integration-test dry run passed. The independently rerun `supabase/tests/artifact_evidence_retention_integration.sql` passed after deployment; post-run checks found zero Artifact, Evidence, and tombstone test rows, and confirmed both triggers, tombstone RLS, and no anonymous tombstone read or trigger execution. A separate rollback-scoped probe using `SET LOCAL ROLE service_role` also confirmed the server role can insert and delete scratch metadata while the definer trigger writes the tombstone. A two-connection contention test has not yet been run, and non-default transaction isolation remains outside this guarantee. Full configured-adapter end-to-end evidence remains outstanding.

The production Storage ACL needs a separate follow-up. `storage.objects` has RLS enabled with zero policies, and the Evolution bucket is private, so client roles currently have no row access through Storage policies. However, grants issued by `supabase_storage_admin` remain on `storage.objects` for `anon` and `authenticated` (including `TRUNCATE`) after the migration's `REVOKE` ran as `postgres`. PostgreSQL only revokes grants issued by the executing grantor or an owning role. Do not mark the table-level Storage privilege invariant as verified; investigate a platform-supported revocation path and its impact on Storage before changing the owner-managed ACL.

The next recovery slice is implemented locally: `20260924153000_artifact_blob_cleanup_security_invariants.sql` adds a nullable blob cleanup timestamp to permanent Artifact tombstones, an index for pending cleanup, and a path retirement lock/check in the Artifact identity trigger. It grants `service_role` only tombstone read and `blob_deleted_at` update. The bounded cleanup service validates database rows, checks for live Artifact metadata, restricts deletion to the configured bucket, verifies Storage existence, removes orphan bytes, and records completion. A `security.admin` operator endpoint supports dry runs; the existing daily Cron checks up to 50 aged tombstones after Job reconciliation and reports missing server credentials or cleanup failure without treating cleanup as complete. Active backend/data-plane health now reports this migration separately. The migration file's normalized SHA-256 is `201ad2c3abd43312bb1f4a414f5b0085a0cc11ecf906413804354a21b51ef23c`. Its exact SQL passed a rollback-scoped production PostgreSQL dry run. The migration combined with the exact `supabase/tests/artifact_blob_cleanup_integration.sql` passed in a second rollback-scoped transaction, covering path retirement, service-role cleanup marking, and denied identity/anonymous privileges. A third rollback-scoped run successfully inserted a migration-history row containing the SQL. With explicit approval, the exact migration and its history row were committed in one transaction to `Evlove-Studio / main PRODUCTION`. Post-commit checks found the new column, pending index, one Artifact identity trigger, private bucket, and one history row whose normalized MD5 `0b5f1b5b12dbd65ce252d81bf9ed2dbb` matches the repository SQL. `service_role` has tombstone `SELECT` and `UPDATE(blob_deleted_at)` but no `UPDATE(artifact_id)`; `anon` has no tombstone `SELECT`. The exact integration test passed independently after deployment under `BEGIN`/`ROLLBACK`, and zero test Artifacts or tombstones remained. The local CLI session pooler connection was terminated remotely and the transaction pooler timed out; the Dashboard SQL Editor supplied the PostgreSQL verification. Unit, adapter, static, architecture, lint, and build checks pass, with 865 tests passed and one skipped. Full configured-adapter end-to-end evidence remains outstanding.

## Execution order

P0–P2 are implemented in code, and the Job lifecycle, Artifact identity, Artifact retention, and blob cleanup SQL migrations passed real PostgreSQL transaction-level verification on production. P3 has a durable execution entry point and the existing Workflow step engine. P4 remains deferred by product scope. P5 has bounded Job and Artifact blob reconciliation, request quotas, database retention guards, and daily Cron wiring. The production-preset build contains 82 Functions. Vercel merges the Cron declaration from `vercel.json` into the Nitro deployment; the Cron must appear only there, because duplicating it in `.vercel/output/config.json` causes a `duplicated_cron_job` deployment error. The production Cron is registered for `/api/evolution/jobs/reconcile-scheduled` at 18:00 UTC daily, and `CRON_SECRET` is configured in Production; an actual scheduled invocation has not yet been observed.

The deployed `main` alias passed the Production Smoke workflow on 2026-09-24 at commit `88ac8f1b024ca202d5f3077b040e7ea6f126fe84`: homepage 200, matching build SHA, passive public readiness showing Supabase server credential, identity, and server AI configured, and protected backend health returning 401 to an unauthenticated request. This is configuration and HTTP perimeter evidence, not a live Supabase adapter probe. Hidden Vercel Production secrets cannot be pulled by the CLI, and the local machine cannot reach the deployment or Supabase network endpoints, so an authenticated production health request and full Mission → Artifact → Validation → Release → Outcome configured-adapter run remain outstanding. Storage's owner-managed ACL discrepancy and two-connection retention contention evidence also remain outstanding. Do not promote these items to verified based on the passive Smoke result.

For each slice, follow `PROJECT_RULES.md`: contracts first, then Core/Harness behavior, adapter persistence, and route composition. Use migrations for all production schema changes. Run architecture checks and builds after architecture-affecting changes, plus focused contract/service tests and runner or browser evidence when applicable.

## Production verification and deferred configuration

Source Parse retries now resolve their existing Job through the indexed `jobs.idempotency_key` lookup instead of reading every Job row. The database unique key remains the concurrency guard; the targeted read removes an unbounded request from every uploaded file. Durable Mission Workflow start still needs a caller-stable idempotency key for unscheduled starts so a transport retry cannot create a second Control Job/run.

Parse multipart uploads now enforce a 25 MiB file limit and a 25 MiB plus 64 KiB total request limit before the form body is buffered. Streaming requests without `Content-Length` are rejected as they cross the total limit.

All Evolution API mutations now have a 32 MiB middleware request ceiling before body parsing, including JSON routes that previously depended only on post-parse Zod validation. Binary uploads, Parse multipart uploads, and signed webhooks retain their tighter route-specific limits.

A second `CRON_SECRET`-protected daily route, `/api/evolution/data-plane-health-scheduled`, performs only the existing read-only Supabase table, Storage, and Artifact cleanup migration checks. It logs only status flags and blocker labels and returns 503 when the data plane is not ready. It is scheduled at 18:05 UTC in `vercel.json` so the Vercel Cron CLI can trigger an active production probe without running Job repair or deleting Artifact bytes. Production results remain pending until that deployment is active and the route is invoked.

The first manually invoked production Cron reached `/api/evolution/jobs/reconcile-scheduled` but returned HTTP 503. A subsequent read-only production Smoke confirmed that `CRON_SECRET` is present and that a request without its bearer token returns 401, locating the failure after the Cron configuration check. The server's direct REST clients also sent new `sb_secret_` keys as bearer tokens; this contradicts Supabase's new-key requirement to use `apikey`. The seven direct REST clients now share a header helper that uses `apikey` alone for `sb_*` keys and preserves bearer authentication for legacy JWT keys. Local tests, lint, architecture checks, and build passed before deployment. A second active Cron result is required before marking the live data plane healthy.

The following external configuration or product-scope decisions remain deferred while backend code work continues:

| Item | Current effect | Completion evidence |
| --- | --- | --- |
| User identity and browser actor assertion | Public production API correctly rejects unsigned browser requests; the current browser clients do not create trusted actor assertions. Multi-user login and workspace ownership remain P4. | Selected identity provider, server-signed actor integration, organization membership, and an authenticated browser flow tested on production. |
| Production Release provider | Online release is capability-gated until a provider and its server-only credentials are configured. | A real Preview/Promote/Observe/Rollback cycle tied to the accepted Artifact. |
| Git and external Connectors | Code paths are present, but each target needs its repository allowlist, webhook secret, manifest, and credentials. | Signed webhook and staged candidate lifecycle against a configured target. |
| Evidence signing and Vault | Signing/Vault readiness depends on server-only key material. | A production signed Evidence append, verification, export, and key rotation rehearsal. |
| Outcome telemetry | External business metrics require source definitions and credentials. | Stable/Candidate samples from a real source bound to the exact deployment. |
| Supabase Storage ACL and retention contention | Owner-managed `storage.objects` grants and two-connection advisory-lock behavior are not fully evidenced. | Platform-supported ACL inspection/change and a concurrent PostgreSQL integration run. |

Do not interpret the passive public readiness endpoint or a successful deployment as proof of these active capabilities.
