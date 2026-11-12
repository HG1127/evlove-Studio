# 2026-11-11 · Artifact Repair Reflection and Memory Contract

## Status

P1 implementation slice: structured AI reflection is now required by the repair result contract and validated against the exact current Candidate and failed criterion scope. Historical repair memory is supplied as bounded non-sensitive archive aggregates.

## AI response contract

RepairArtifactAiResultSchema now requires a reflection object:
- parentCandidateId: exact Candidate identity bound by the server request.
- rootCause: explanation grounded in supplied failed criterion evidence/gaps.
- failureCaseIds: exact IDs from the request-bound failed criterion list.
- mutationRationale: causal explanation of the proposed change.
- preservedCapabilityIds: capability preservation attestation, not proof of validation.
- antiPatternsAvoided: known ineffective mutation families the proposal intentionally avoids.

The server-specific AI contract narrows the parent ID and failed criterion IDs to exact request values and mirrors those constraints into the provider JSON Schema.

## Historical repair memory

The repair request receives only the last eight archive summaries and aggregate mutation-family statistics. The aggregation is implemented as a pure Core function in packages/core/src/artifact-repair-memory.ts and reused by the backend adapter, keeping domain logic out of the service layer:
- round, outcome kind, score, safety result, failure count;
- normalized patch-family identifiers;
- repeated families with failures and no Champion wins.

No hidden holdout prompts, answers, raw test inputs, or private final-paper contents are included. This memory informs the proposer but does not change scoring, gates, budgets, or acceptance thresholds.

## Enforcement

Before materializing any new Candidate, the server validates the reflection against:
- the exact current Candidate ID;
- the exact failed criterion IDs passed to this repair attempt.

A mismatched parent or unobserved failure reference is rejected before artifact writes. Existing candidate parent-byte checks, Visible/Hidden evaluation, independent final holdout, repair budget, at-most-once behavior, evidence archiving, and Gate F remain unchanged.

The local/demo repair path also emits and validates the same reflection contract. The accepted response reflection is stored on the new Candidate as repairReflection, so it remains part of the Evolution Archive. The Core repair-memory builder then feeds the bounded prior reflections and anti-patterns into subsequent repair proposals; it stores only the structured diagnosis/rationale and declared preservation list, not raw test inputs.

## Validation

Focused Vitest:
- artifact mutation governance: 19 passed;
- repair memory aggregation: 2 passed;
- server AI repair contract: 6 passed;
- server artifact repair: 32 passed;
- total: 59 passed.

Focused TypeScript contract check passes for the shared schemas, Core governance, and server AI repair contract.

A broader P1 typecheck was attempted but remains blocked by unrelated workspace dependency/type environment issues (AI SDK resolution, Vite/adapter transitive package links, PDF.js and test assertion typings). No dependency installation or lockfile change was made.