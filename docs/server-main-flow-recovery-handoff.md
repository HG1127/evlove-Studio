# Server main-flow capability recovery handoff

## Scope and integration

Development branch: `codex/server-main-flow-recovery-validated`, checkout `D:\Downloads\evolution-os-smoke-temp\server-main-flow-recovery-build-worktree`.
Runtime source: `85ad4dad91e9f10fec2c302595b77a748a441599`; base is `3cb196781747488d83101b18cd8cc1f865b61fba`.
Apply only these incremental commits after the already validated format fixtures: `25446c7`, `c5f0c95`, `0fd14a3`, `85ad4da`. Do not reapply their agent equivalents `bc2503`, `484d1b9`, or `d7231dd`.
Git owns the integration candidate and main synchronization; CI owns independent verification. Root has not pushed, merged, deployed or changed credentials.

## Main-flow blockers addressed

- Actual server capability pauses now persist a versioned recovery receipt bound to Mission, originating control Job, round, checkpoint, exact Source/parent/Candidate, papers, rubric, policy and evidence. The backend verifies a canonical SHA-256 before admitting a different active control Job and again at execution. Cancellation, approvals, changed inputs, Safety/protected/manual failures and elapsed/cost/round budgets remain stop boundaries.
- Initial Builder, Baseline/Judge, diagnosis, grounded Plan, paired Hidden/Judge/Review and Gate F readback/repair waits can be explicitly retried at their saved boundary. Existing frozen Experiment execution journals retain their own recovery path. Reconfiguration alone does not erase failed evidence or approve an artifact.
- Old zero-Candidate Plan pauses lack an old input binding. A separate explicit `remeasure-current-input` intent with stored version and stable idempotency key archives old Baseline/rootBaseline/diagnosis/checkpoint before fresh measurement. Lost acknowledgement, replay and Mission CAS failure keep the same authoritative archive and Job. Sources, papers, history, costs and the original time-budget window remain.
- Weak Diagnosis is rechecked before Plan, including a recent reusable Baseline. A retry executes diagnosis again; weak output still waits. A trustworthy saved diagnosis is retained without repeating it.
- A control-AI receipt binds the exact machine attention-request ID into its context and SHA. Recovery preserves resolved history and recognizes that one request without mixing it with old same-reason entries. Older control-AI receipts lacking the ID cannot authorize recovery.
- Hidden assessment completion is recorded separately from its physical `baselineObservedAt`. Gate F retries retain the complete paired Hidden record and Candidate bytes while recent. A recent Judge receipt cannot refresh old executions; expired observations or a changed scoring route require real paired execution again.
- Before resumed Artifact Gate F, current and Candidate physical bindings are read again. Missing identity waits without overwriting old evidence. A changed binding stops acceptance, retaining the original parent and Hidden record; it is not silently adopted as a new baseline. Frozen files are not regenerated or renamed after passing acceptance.

## Local evidence

The complete related regression covers 53 unique files and 729 tests, all passed. Targeted control-AI recovery covers 32 tests; weak-diagnosis slice covers 32 tests. Previous failed attempts remain in the temporary evidence directory. The initial production build failed because a whole node_modules junction placed generated Workflow imports in the older checkout. Replacing only that junction with a local dependency container and offline child links isolated generated caches; the unchanged runtime then built successfully. No network installation or dependency-version change was used.
Final architecture, full lint, TypeScript/production build and Runner11 all passed. The compiled readonly UI passed five routes, mobile390 and denied-storage recovery with zero page errors or attempted writes. All 24 runtime/test source hashes match the build input, and all 419 generated-file hashes remained unchanged during the readonly check. The owned 8107 preview was stopped afterward; the existing 8000 listener was preserved. Runtime source hashes and aggregate receipt are recorded in `D:\Downloads\evolution-os-smoke-temp\main-flow-recovery-build-source-hashes.json` and `main-flow-recovery-development-handoff.json`.

All tests use synthetic Missions with injected model/browser/storage ports. They exercise the actual start/planner/execution functions and physical fixture materialization, hashing and readback; they do not prove a live provider, live durable Workflow, production Supabase writes or a real user Mission.

## Production and remaining acceptance

Readonly public build-info at 2026-10-09 11:36 UTC still identifies `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`, main/production. This proves only that deployed version, not this branch.
The prior independent local integration candidate `37695a6` passed its complete gate (2433 tests passed, zero failed, one explicitly skipped live Sandbox case). That result does not cover these new recovery commits. Hosted Quality Gate is still blocked before steps by account billing/allowance; a new independent candidate gate is required.

The previously authenticated real Mission record remains `project-1790480873333`, revision 11, paused Plan, zero Candidates. Its exact current pause marker was not newly observed. Six stored Baseline runs are historical; no fresh live execution is claimed.
Original recorded artifact: `artifact-2ac80e2f-b1f2-4cb9-a3bf-8587577f767f`, 264173 bytes, SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`.

Manual custom model/key, operator/Vault and authorized file-export setup remain deferred. The project supports user-added models through its provider abstraction; these tests neither require nor configure Vercel AI Gateway. Real fresh Baseline, changed frozen Candidate, same-Hidden current/Candidate execution, Gate F and downloaded/reopened accepted SHA-256 remain unproven until the real Mission receipts are recorded. No mutating production Cron was triggered.
