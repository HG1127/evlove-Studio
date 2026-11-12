# 2026-11-11 · Durable Repair Reflection Evidence

## Status

P2 implementation slice: every successfully materialized server-side repair now receives a separate immutable reflection evidence artifact. The Candidate stores only the typed reference plus the compact reflection fields.

## Evidence lifecycle

1. The server receives the structured AI reflection.
2. The server checks the reflection parent against the exact frozen Candidate and restricts failure IDs to the current observed failure scope.
3. The server constructs the new Candidate and materializes all artifact outputs through the existing all-target preflight and frozen-byte pipeline.
4. Only after successful materialization does the server serialize the reflection evidence envelope, calculate SHA-256 from the actual UTF-8 bytes, and archive it.
5. The archive service verifies the payload binding, metadata identity, MIME type, size, SHA-256, and exact-byte readback.
6. The new Candidate stores repairReflection and repairReflectionEvidence. Evolution Archive therefore retains a stable reference to the immutable evidence artifact.

The archive envelope contains Mission ID, new Candidate ID, parent Candidate ID, repair attempt, observed failed criterion IDs, structured reflection, summary, and artifact source IDs. It does not contain hidden holdout prompts, answers, raw test inputs, or generated file bodies.

## Failure behavior

- Invalid reflection is rejected before materialization.
- Invalid patch construction, no-op changes, stale parent bindings, or frozen-file failures occur before reflection evidence is archived.
- If immutable evidence storage or exact-byte readback fails after materialization, the Candidate is not returned to the repair lifecycle; the repair remains failed under the existing budget/claim rules. The already-frozen artifact bytes are not promoted and may require orphan cleanup by the existing artifact retention process.

## Validation

Focused P1/P2 regression suite:
- artifact mutation governance: 19 passed;
- repair memory: 2 passed;
- server AI repair contract: 6 passed;
- server Artifact Repair: 32 passed;
- total: 59 passed.

No dependencies or lockfiles were changed. No production deployment or main-branch merge was performed.