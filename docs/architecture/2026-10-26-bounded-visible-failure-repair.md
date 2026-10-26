# Bounded repair of measured Visible failures

Date: 2026-10-26. Status: implemented; synthetic verification only. This decision follows the existing package boundaries and does not change an acceptance threshold.

## Problem

Server Experiment previously archived every completed round without a Winner. The only directed feedback repair entry was after ordinary Hidden/Gate F. A future trial with a permitted repair could therefore stop on a measured Visible quality failure before reaching that entry.

The actual third SOP confirmation also had Safety FAIL and `stopOnSafetyFailure=true`. Stopping that trial was correct. Its unused repair does not authorize reopening it, and this feature cannot repair or re-rate its sealed result.

## Decision

`experimentPolicy.visibleFailureRepair="experiment-visible-repair-v1"` explicitly enables the new path. An absent field and `disabled` preserve legacy behavior; parsing legacy Missions does not inject a new policy value. No existing trial is migrated or enabled automatically.

Core selects a unique frozen Candidate only from complete, verified Visible observations on the current comparison suite/Baseline, with an actual failed criterion, Safety PASS, a non-demo assessment and the original independent-final paper binding. Missing capability, a changed paper/contract, ambiguous identities, or a configured resource/safety stop cannot create a repair. The original independent paper is neither replaced nor disclosed to mutation AI.

Harness retains the complete failed Experiment, snapshots, observations, comparison suite/Baseline and parent/child lineage in a versioned `visibleRepairAttempts` record. It debits `artifactAcceptance.attempts` when reserving the attempt, using the same `maxRepairAttempts` as Hidden/Gate F. The reservation is persisted in one control step; a later step rechecks its SHA-256 input binding and reads back every frozen parent. There is no additional initial Candidate, new round or patience/time reset.

Immediately before the mutation call, Harness rechecks resource limits and requires the injected writer to compare-and-swap the loaded Mission revision with a `running` marker. The workflow supplies its existing revision-scoped production Mission store. A conflict or unavailable save prevents the call. An interrupted running call remains charged and stops rather than automatically repeating an unknown result. The claim also records a conservative next-round cost estimate for the extra mutation/revalidation work and adds it to cumulative estimates, including a failed call. This is not actual monetary billing.

The application composition reuses the existing targeted repair provider with Visible failed criterion evidence and measured text, rather than stale Hidden scores. The existing body-sharing authorization still applies. Known renderer component constraints accompany the body edit index. Materialization binds all read text parents to their original full SHA-256, preventing a provider response from applying to a changed parent.

A successful repair needs a new Candidate identity, physically changed bytes, complete frozen targets and the unchanged final-paper hash. Its new snapshots are retained in the repair record. Recovery checks those exact snapshots and re-reads their physical bytes; changed identity cannot fall back to generation. The new file has no inherited passing score: it must run the complete Visible suite, ordinary Hidden, independent final and Gate F before the accepted-byte packaging path. A second failure consumes no extra repair beyond the shared configured total.

Contracts own the versioned DTO, Core owns eligibility, Harness owns reservation/claim/execution/recovery, and apps supply the AI/storage composition. The existing 23-node workflow and production-release authorization stay in force.

## Verification and limits

Synthetic tests cover storage round-trip fingerprints, unchanged legacy behavior, concurrent claim conflicts, provider interruption, exhausted budgets, time/safety stops, modified contracts/papers/bytes, duplicate scores, missing evidence, exact frozen-child recovery, full revalidation and packaging. Injected assessments exercise both Hidden success and failure; passing these tests is not SOP acceptance, actual user benefit, monetary improvement or causal lesson transfer. A newly authorized real trial must pre-register this policy before planning and preserve every prior failed trial.
