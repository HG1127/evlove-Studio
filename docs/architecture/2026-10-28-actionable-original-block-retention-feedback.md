# Locate unmatched Original blocks in bounded construction feedback

Status: implemented for validation, 2026-10-28.

C16's initial proposal and its existing construction correction both passed the production output parser and issued-node contract. Static replay of the actual captured replies found the same changed CODE anchor in `slide-102`; each compiled proposal retains 55 of 57 Original PRE/CODE blocks. The first proposal also exceeds the unchanged paragraph budget at 247/240 characters. The correction fixes that paragraph while repeating the same protected-code rewrite. Aggregate retention counts identify no block location, even though the deterministic matcher knows which Original blocks remain unmatched.

## Decision

The pure Core retention matcher now also collects the one-based Original block index, tag and nearest Original element ID for unmatched blocks. `htmlNativeCodeRetention` returns exactly its existing policy/count/boolean object; native evidence, matching order, duplicate handling, entity decoding, numbered-prose compatibility and acceptance thresholds are unchanged. Only `HtmlOriginalCodeRetentionError` carries the supplemental location list. Legacy direct construction of that error remains compatible with an empty list, without invented locations.

Backend construction feedback forwards at most 20 measured locations and an explicit omitted count. It labels them as Original location hints, never current-parent byte offsets or request-issued anchor IDs. It sends no original block text, scripts, styles or final-test questions. The already supplied current Targets and invalid proposal remain the correction context. No new model request, construction correction, Candidate, evaluation repair or time window is added. Both initial-build and existing opt-in repair construction paths use the same helper; unknown or forged errors still grant no correction.

This is diagnostic feedback before freezing. It does not authorize code changes, silently drop a model edit, repair the failed C16 artifact, or bypass the full retention/paragraph/native/quality gates. C16 remains sealed and unsuccessful.

## Validation and limits

Tests cover original location identity, nested PRE/CODE indices, duplicate multiplicity, entity-equivalent retention, unchanged evidence shape, absence of code text, legacy empty hints, bounded forwarding and rejection of forged errors. The existing single-correction integration now verifies the locations reach the model while retaining the same parent and write fence. Static replay of the two actual C16 replies reproduces the missing blocks without executing HTML, network access or further generation.

This establishes actionable feedback plumbing, not that a later model uses it successfully. Exact accepted SOP delivery, actual controlled business benefit and causal Lesson transfer still require their original separate evidence.

Final local verification passed 147 tests in 14 related files, 11 Runner tests, architecture check, changed-file lint and the full TypeScript/production build. The first build caught an unsupported constructor parameter property under `erasableSyntaxOnly`; it was replaced with an explicit field, the original failure log was retained and the checks were repeated successfully. Replaying both actual C16 proposals through the new feedback yields Original blocks 48/49 in `slide-102`, with the same compiled hashes and retention reports as the pre-fix replay.
