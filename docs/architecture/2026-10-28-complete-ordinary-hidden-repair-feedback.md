# Version ordinary Hidden repair for complete paired feedback

Status: implemented for validation, 2026-10-28. Opt-in only.

The legacy `verifiedValidationFailures` selector includes only verified absolute FAIL rows. A synthetic complete same-paper counterexample has two original user goals: content 90 → 95 and readability 90 → 89. Both still pass their minima, yet an available ordinary Hidden repair cannot address the readability regression. This is a policy diagnosis, not C18's final-browser failure or a measured user outcome. C19 did not reach ordinary Hidden.

## Decision

Add explicit `experimentPolicy.hiddenFailureRepair = "artifact-targeted-repair-v2"` and a separately discriminated v2 persisted claim. Absence or explicit v1 preserves the old selector and claim serialization. V2 combines verified absolute failures, including a contradictory PASS below its numeric minimum, with separately proven regressions of every original user goal under `all-user-goals-v1`. The union follows rubric order. Relative rows retain their real absolute PASS; the backend provides paired scores and distinguishes absolute, relative and combined scopes.

Comparative feedback requires a complete non-demo Candidate report bound to the exact Candidate/input, an identical ordinary Hidden baseline suite, unique executed case identities, an observed baseline context, and complete paired verified scores and successful observations for all mapped user-goal cases. Missing, duplicated, partial, errored, foreign or contradictory evidence creates no relative mutation target. Independently proven absolute failures remain usable when unrelated paired evidence is incomplete. Safety failure still stops.

For a new v2 Mission, known ordinary Hidden goal regressions block acceptance and blind-final execution even if an old recommendation says release. Missing required paired goal evidence stays unverified. The v2 policy enters the final contract fingerprint before reservation, in addition to the existing complete mutation/scoring policy bindings. Enabling it after Candidate feedback cannot reuse an old reservation. No existing paper, score, threshold or Mission is migrated.

Harness archives the complete existing report, binds the scope/classification/policy in the claim fingerprint, and persists the same shared repair debit before invoking the model. Core and backend revalidate the complete running scope and original preplanning paper, accounting for the already recorded cost estimate without granting another allowance. The repaired child must have different frozen bytes and complete source identity, and rerun Visible → ordinary Hidden → unchanged blind final → Gate F. Final feedback cannot drive a mutation. The existing repair-output construction correction remains the only such opportunity.

An interrupted running claim remains pending even when its only slot was already debited. Previously that edge could settle the unknown invocation as an exhausted failed round. The earlier fence now preserves the unknown result and forbids both automatic resend and premature settlement for v1 and v2. This implements the existing interruption rule; it does not reopen a historical attempt.

The strict new claim version leaves the old reader's shape, field order and unknown-field behavior unchanged. Domain selection stays in Core, execution and revision claims in Harness, Zod contracts at boundaries, and provider formatting in the backend. Storage remains versioned JSONB without a migration or architecture exception.

## Validation and limits

Tests cover strict v2 classification, legacy serialization/defaults, complete and incomplete paired evidence, truthful passing rows, mixed feedback, contradictory numeric minima, policy/paper/scope/kind/cost tampering, archive/CAS failures, shared limits, interrupted claims and immutable frozen recovery. An injected end-to-end flow exercises one v2 child through all validation stages and packages the same tested bytes. These synthetic ports establish execution mechanics, not real model improvement or human benefit.

The first new flow run exposed one actual single-slot interruption defect and two fixtures that mutated the in-memory claim and Candidate through a shared reference. The interruption fence was repaired; the recovery fixtures now reload the persisted schema boundary before tampering, matching the existing recovery tests. All original failure logs remain. Final related verification passes 267 tests in 13 files together with the source-anchor feedback regressions. Actual model use of v2 remains unverified; C19 ran its registered legacy ordinary Hidden policy and stopped earlier.

The final TypeScript/production build, architecture and changed-file lint checks, and all 11 Runner tests passed. The new reader also preserves the exact full formal hashes of sealed C17, C18 and C19 with this policy absent. A separately labelled synthetic replay still reproduces v1's omission and selects the passing-but-regressed readability goal only for v2. No historical retry, real model repair, user sample or remote write is created by that replay.
