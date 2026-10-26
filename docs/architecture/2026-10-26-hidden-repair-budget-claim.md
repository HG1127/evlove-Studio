# Durable budget claim before Hidden feedback repair

Date: 2026-10-26. Status: implemented; synthetic verification. No acceptance threshold or paid-trial authorization changes.

## Measured defect

A failing local regression on `e35a707` showed that Gate F's targeted repair invoked mutation AI before any injected persistence call. The attempts counter was incremented only in the returned in-memory project. A process interruption could lose the counter and allow another invocation under the same budget. The earlier Visible repair path already persisted its own claim, but did not cover the Hidden path.

## Decision

Every server targeted Artifact repair now requires the caller's revision-scoped compare-and-swap Mission writer and SHA-256 provider. The existing workflow supplies its loaded production store, whose save checks and advances the expected revision. Missing persistence capability, conflict, or unknown save response cannot fall back to an unclaimed provider call. A running invocation found on recovery pauses without automatically sending another mutation request.

The optional versioned `artifactRepairAttempts` metadata records the exact failed Hidden report, preceding Experiment, acceptance results, parent identity, unchanged independent-final hash and repair input fingerprint. The shared `artifactAcceptance.attempts` counter and conservative extra-work estimate are saved with the running claim before AI. Provider failure consumes that attempt and estimate; a known failed call may use a remaining attempt only after an explicit resume and the unchanged resource checks. An unknown running call cannot be retried by merely increasing the counter. Estimated cost remains separate from actual monetary billing.

The actual sealed third SOP Mission is 3,302,732 bytes. Duplicating its Experiment/validation/acceptance plus child snapshots would add 2,138,045 bytes even before a real Hidden report. The complete failed reports therefore go into an immutable private Artifact, with Mission binding, content SHA-256, exact size and metadata/byte readback. The attempt keeps the validated reference rather than a second copy of every measured body. Reports are not truncated. Existing Mission-bound Artifact retention applies; installing the code does not write a new archive for a historical trial.

A read-only replay on those sealed bytes validates a complete 1,816,720-byte feedback report and its 382-byte reference. It leaves source SHA-256 `b6c0ec1f3e9ad5ede56f12975c63d6f4e417a9f9dad7cbfc7a271e16023eea6d` unchanged, consumes no final paper and makes zero paid calls or remote writes. This checks the archive contract and size; it is not a new hosted Artifact or an acceptance verdict. The existing Visible-v1 inline history is preserved for compatibility and is not silently converted by this change.

Resource checks run before and after the save. The existing window, round, patience, cost and Safety limits remain binding. Directed feedback repair also requires the original planning-time independent paper binding, and stops once an independent-final execution record exists. A legacy Candidate without that binding is retained but cannot spend money on a feedback mutation that could not later qualify for final acceptance. No paper is generated or replaced after feedback.

The repaired Candidate must have a unique new identity, physically changed bytes, every frozen target and the unchanged final binding. Its physical receipts are re-read and compared through Core's existing exact frozen-set identity policy. The child snapshots are retained in the repair record; recovery cannot replace changed snapshots by generation. The normal complete Visible → ordinary Hidden → independent final → Gate F → same-byte packaging path remains mandatory. Missing evidence is not a product failure or a passing verdict.

The typed metadata is additive. Legacy successful acceptance and exact frozen recovery keep their existing contracts; no stored Mission or sealed trial is rewritten by installing this code. Runtime extraction stays within contracts/Core/Harness/application composition, following `PROJECT_RULES.md`.

## Verification and limits

Synthetic tests cover the original ordering defect, storage round trips, concurrent CAS claims, interruption, known provider failure and explicit resume, exhausted budgets, slow saves crossing the deadline, missing writer/hash capabilities, missing/changed/consumed final papers, changed/duplicate/no-op children and exact frozen recovery. A connected injected test runs a claimed Hidden repair through complete revalidation and accepted-byte packaging while preserving the initial negative report. Existing workflow routing and production CAS tests cover composition.

These results do not establish real SOP acceptance, actual user benefit, monetary savings or causal lesson transfer. No additional paid trial is started, and this fix does not reopen a terminal trial or change a pending human authorization's resource limits.
