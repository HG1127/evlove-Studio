# 2026-11-11 · Artifact Mutation Governance Contract

## Status

P0 additive contract and pure-domain validation. This does not alter the existing repair state machine or authorize candidate acceptance.

## Why

Multi-type artifact experiments showed that model-generated changes can improve a target criterion while silently deleting an existing capability. The mutation boundary must therefore be constrained by immutable parent identity, file roles, explicit writable paths, evidence references, and regression evaluation.

## Contract ownership

- packages/contracts/src/artifact-evolution-contract.ts defines versioned Zod contracts for file inventory, mutation policy, mutation patches, reflection evidence, and an artifact evolution envelope.
- packages/core/src/artifact-mutation-governance.ts contains pure validation for patch plans, parent bindings, protected paths, observed failure references, capability-preservation attestations, and per-file mutability.
- packages/core/src/artifact-mutation-governance.test.ts verifies the deterministic invariants.

## Enforcement boundaries

1. The model may propose paths and content, but it never applies filesystem writes.
2. A trusted Harness/adapter must compute SHA-256 from the frozen parent bytes and the proposed output bytes. The Core validator compares those trusted digests; it does not compute cryptographic hashes itself.
3. The Harness must apply patches only after validation, against the exact parent snapshot, in an isolated workspace.
4. preservedCapabilityIds is an explicit proposal attestation, not proof that behavior is preserved. Existing visible regression suites, hidden validation, independent final holdout, and Gate F remain mandatory.
5. Reflection failure IDs and patch evidence IDs must be grounded in the visible failed-case set. Hidden holdout contents and answers must never be passed to the proposer.
6. File deletion is denied by default. Protected files, tests, and files outside the explicit allowlist cannot be mutated.
7. No-op updates, stale parent hashes, path traversal, oversized files, duplicate paths, and excessive changed-file counts are rejected.

## Existing Evolve Studio integration points

This contract is intended to be called by the existing Candidate/Repair path:

- CandidatePatch and CandidateArtifactSnapshot remain the existing candidate and snapshot representations.
- Diagnosis and TraceEvidence remain the source of failure attribution.
- Visible Repair and Artifact Repair continue to own budget, attempts, checkpointing, and at-most-once execution.
- Repair Evidence remains the immutable archive for detailed reflection history and mutation provenance.
- Existing validation, hidden holdout, independent final evidence, and Gate F remain the only acceptance/promotion authority.

No second Optimizer, CandidateStore, Champion registry, or repair lifecycle is introduced.

## Deliberate non-goals of P0

- No AI prompt changes or model execution.
- No filesystem patch applier.
- No database migration or persisted Mission-state expansion.
- No UI changes.
- No change to acceptance thresholds or promotion behavior.
- No production deployment.

## Validation

Focused governance tests cover allowlist enforcement, path traversal, protected files, stale parent hashes, no-op changes, delete policy, capability attestation, evidence grounding, duplicate/excessive patches, file-role constraints, dependency resolution, reflection-parent binding, and file-size limits.