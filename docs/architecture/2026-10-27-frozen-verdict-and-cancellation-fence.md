# Preserve frozen validation verdicts and fence cancelled control writes

Status: accepted, 2026-10-27. No dependency-direction exception.

## Observed failures

Confirmation seven produced a physically frozen Candidate with passing Visible scores, Safety and native protection. Ordinary Hidden retained all absolute minima but rejected its paired regression against the same-paper current document. `hasServerFrozenValidationCheckpoint` recognized only absolute criterion failures. The preparatory-baseline cache missed, so the next control step reran Baseline and reset the Candidate and reports instead of settling the frozen verdict. It then planned another draft without consuming the shared repair allowance. This violated the registered one-initial-Candidate bound.

Cancellation exposed a second fault. The durable Job became cancelled at `03:08:45.488Z`, but an in-flight planning call started a structured-output retry at `03:09:49.102Z` and persisted a new draft at `03:11:38.926Z`. Control Job availability was previously checked after Mission writes. The owned backend was stopped at `03:12:09.466Z`; the trial cannot be resumed or described as successful.

## Decisions

Harness recognizes every complete, fingerprint-bound frozen validation checkpoint, independent of absolute score polarity. It routes to the existing acceptance/repair settlement before preparatory Baseline reuse. Physical verification, Safety, paired comparison, repair eligibility, independent final and Gate F remain unchanged. A complete report is routing evidence, not permission to deliver. Invalid fingerprints, incomplete frozen sets and unrelated adapters remain excluded.

Backend composition binds planning, action execution, scheduled triggering/settlement and failure-pause writes to the original control Job. A scoped cooperative guard checks its identity, generation and active status before physical AI attempts, retries, artifact uploads, new HTML Sandbox executions, Mission writes and control events. A two-second durable poll aborts pending AI requests when cancellation occurs on another instance; the cancellation endpoint also aborts matching local scopes. Provider timeouts and cancellation signals are combined. Scope cleanup is deterministic. Unavailable Job reads fail closed. Usage results remain recordable after cancellation so already-started calls do not disappear from accounting.

The new service-only `compare_and_swap_control_mission` RPC acquires the same transaction-scoped Job lock as cancellation, locks the matching Job row, then invokes the existing Mission revision CAS with its optional checkpoint Event. Terminal, missing, unrelated or replaced Jobs cannot commit. This closes the gap between an application precheck and the actual database commit. Existing unscoped API writes retain their original CAS; a missing new RPC fails closed with no fallback. The migration must be installed before using the updated backend.

No Domain or Harness module imports platform implementations. Async execution scope and durable Job reads stay in backend composition; Harness checkpoint classification remains pure. No new Candidate, repair budget or paid confirmation is inferred.

## Verification and limits

Regression tests reproduce the old relative-hold/reset and late-success/write faults. They cover relative hold and release routing with an expired Baseline, cancelled/missing/replaced Jobs, pending HTTP abort, suppression of malformed-output retry, retained usage accounting, cancellation of the local scope, rejection before another native Sandbox, and atomic commit fencing. Transactional tests on the real project exercise active commits, revision conflicts, generation mismatch, checkpoint-event atomicity, cancelled/missing Jobs and service-only access, then roll back all test changes.

Release checks passed: 334 focused tests in 17 files, 11 Runner tests, production build, package architecture check and lint of every changed TypeScript file. The migration was applied with an exact prior-history guard and verified source digest. These checks use fixtures or rollback-only transactions and make no new paid AI/Sandbox calls.

Cancellation cannot refund or prove termination of a request already accepted by the provider. An already-running isolated HTML execution retains its bounded timeout and existing `finally` cleanup; this guard prevents subsequent executions and publication of late results. No actual monetary charge is inferred from tokens. The observed full initial Visible/Hidden reports were overwritten before cancellation; pre-reset summaries and exact frozen bytes are retained, and missing reports are not reconstructed as authoritative evidence. Fixes and engineering checks do not prove a successful SOP delivery, human benefit or causal lesson transfer.
