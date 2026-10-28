# Measured comparison Baseline text for scoped repair

Date: 2026-10-29

Status: implemented and locally verified; actual improvement remains unproved.

## Measured gap

C31's sole repair improved its Visible result enough to become Winner, but ordinary Hidden retained a three-goal regression and stopped promotion. The original failed trial, one-repair limit, reserved final paper and all gates remain unchanged.

Offline replay exactly matches actual first-repair request SHA-256 `249ac9cb3578e8611b9b24fded87cd5063e279c07b9368fd9877877294da5541`. That request contains current Candidate body, comparison scores and Original physical facts, but lacks the complete measured Baseline body. A valid same-Visible Baseline rendered document of 28,105 characters was already stored and bound to Original SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`. This establishes an input omission, not its causal contribution to Hidden failure.

## Decision

Contracts define strict version `repair-baseline-documents-v1`. Harness projects existing complete rendered HTML observations into read-only text references, without storage/HTTP reads or raw HTML reconstruction. The Visible path uses the committed comparison Baseline/suite; ordinary Hidden uses its bound Baseline runs and suite IDs. Independent-final records are never inspected.

Each projected body must match a unique current-Mission Original reference, Target source, Candidate source mapping and ordinary test ID. Existing native evidence inspection checks the producer receipt, physical SHA, body fingerprint and complete observer structure. Changed/foreign/duplicate references, changed suites, wrong phases/Candidates, future observations, unverified or conflicting bodies are omitted. A 64,000-character serialized-document budget omits a complete body rather than silently truncating it. Output is Zod-validated again and carries explicit limitations, without Criterion verdicts.

Application composition supplies this context only under the existing Mission-specific full-body consent and bound feedback. Without consent it adds no new body field. Baseline text carries no edit anchors, raw programs/styles/attributes, connector configuration or independent-final inputs; only the current frozen Candidate retains usable edit IDs. Document instructions are treated as content. Missing bodies remain unknown, and other formats retain their prior repair/materialization path.

This changes mutation input, not judgment prompts, scoring identity, user goals, output modes, protected items, correction/repair limits or acceptance. No database migration, SDK, infrastructure, UI flow or architecture exception is introduced.

## Verification and limits

The actual repair-entry counterexample first fails because the Baseline field is absent. Positive and adversarial tests cover both ordinary phases, file/Mission/suite bindings, duplicate or conflicting observations, non-editable references, budget omission and consent-off behavior. Strict boundary tests reject raw HTML, anchors, partial bodies, oversized text and final-paper fields.

Final offline replay on the same C31 data includes the complete measured Baseline while keeping the parent bound to SHA-256 `d3a8083f52688214dd238ab2494d7e928325d1b7856f79b4bd548175c8fd9039`. The proposed context is 32,506 characters, SHA-256 `31a8947eb8e28117f40ac2109b843f33dec7ef6d43f02e25208275f749831b47`; the changed request has SHA-256 `b20518b99a46eab484e4d5409afb3c3dd16559e4413637ceb6c004d890296a17`. Its difference from the old actual request is expected. No real provider, execution environment or remote writer is called, and no user HTML is executed on the host.

Verification passes 254 related tests across 13 files, all 11 Runner tests, architecture/changed-file lint and the full TypeScript/production build. Two new test fixtures initially lacked a required experiment-stage field; the original failed build is retained, the fixtures were completed and their 29 focused tests and full build rerun passed. Runtime schemas and assertions were not weakened.

A new separately registered trial is required for actual repair/acceptance evidence. This mechanism alone establishes neither an improved SOP, real-user benefit nor causal Lesson transfer.
