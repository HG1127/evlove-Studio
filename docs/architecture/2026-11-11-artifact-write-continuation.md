# P2-C · Trusted artifact-write continuation

Date: 2026-11-11
Workspace: D:\Downloads\evlove-studio-evolve-p0
Branch: codex/artifact-evolution-governance-p0, above 60608f7; not committed or deployed.

## Status

P2-C implementation and focused regression acceptance are complete for the server-side governed text/ZIP paths: server-issued write-lineage receipts, permission-preserving parent rebinding, public-upload namespace protection, and exact frozen-output cycle checks are integrated into the existing Visible and Hidden repair executors.

The final authorized Vitest run passed 219/219 tests across 12 files. The stale ZIP write-count assertion was corrected to expect two writes (frozen output plus lineage receipt). New continuous repair-loop, A-to-B-to-A stop, shared-budget exhaustion, and Hidden duplicate-output tests all executed and passed.
## Authority and data flow

The original SourceArtifact.mutationGovernance remains unchanged. It contains the original approved parent SHA-256 and the exact mutation policy.

For the first generation, the materializer verifies the approved original bytes. After all target preflight checks and frozen-output readback succeed, it writes a server-owned artifact-write-lineage-v1 receipt. The receipt binds Mission, source, output name, Candidate, parent Candidate when present, original approval digest, actual input hash, frozen output hash/blob/snapshot identity and size.

For a later generation, the existing current-parent resolver selects the frozen parent. The lineage resolver reads the server receipt, validates its metadata and actual bytes, and checks that it was generated under the same original approval. Only the effective in-memory parent SHA is rebound. All file permissions, protected subtrees, deletion settings and limits remain identical. The original approval is not rewritten and no AI-supplied policy or claimed receipt is used.

A receipt proves how a candidate was produced, not that it passed evaluation. It permits an already selected parent to be repaired; it cannot select a Champion or bypass Visible, Hidden, final holdout or Gate F.

## Layer ownership

- Contracts: ArtifactWriteLineageSchema and public-upload namespace restrictions.
- Core: repeatedRepairOutputBlocker compares complete frozen target vectors.
- Harness: archiveArtifactWriteLineage and resolveArtifactWriteGovernance use injected storage and hashing ports.
- Backend: the existing materializeServerCandidateArtifacts composes byte verification, governance preflight, output persistence and lineage archival.

The existing repair state machines continue to own reservations, compare-and-swap persistence, budgets, attempts, interruption recovery and promotion gates. No additional optimizer or scheduler was introduced.

## Upload boundary

The generic registration endpoint can ordinarily receive artifact IDs and kinds. Consequently, both ArtifactRegistrationRequestSchema and BinaryArtifactUploadMetadataSchema now reject the reserved artifact-write-lineage- ID prefix; registration also rejects the candidate-write-lineage kind. Internal artifact identity/read schemas are not globally restricted. This protects the inspected API boundaries; it is not a claim that a database/storage administrator cannot tamper with records.

## Replays, failures and stop behavior

Identical receipt replay checks the stored exact identity and content without overwriting it. Conflicting parent/input bindings and orphan receipts fail closed. Receipt corruption, absent metadata, altered Mission/source/Candidate identity, changed approval or expanded permissions prevents next-generation writes.

The existing Visible and Hidden repair executors now reject a returned candidate whose entire frozen target vector reproduces a prior candidate under another ID. This detects exact-byte A-to-B-to-A cycles. It does not claim semantic-equivalence detection, or ZIP equivalence when archive metadata changes the binary hash. The already-spent repair attempt is retained and the existing failure path pauses execution.

All target checks still precede persistence. This is validation atomicity, not a cross-object storage transaction. Storage failure after artifact freeze or after some lineage records are written may leave orphaned records; no Candidate is returned or promoted on that failure. The archive relies on the existing serialized Mission repair claim rather than providing a new distributed storage CAS mechanism.

## Validation evidence

Final report: `artifacts/validation/p2c-final-tests.json`.

Final Vitest result: **12 files passed, 219 tests passed, 0 failed**. The suite includes:
- 19 lineage receipt/rebinding tests;
- 14 multi-generation tests, including three ZIP generations, serialized text continuation, mixed keep-parent targets, tamper rejection, two sequential Visible repairs, A-to-B-to-A cycle stop, and shared repair-budget exhaustion;
- 11 Hidden Repair V2 tests, including duplicate frozen-output rejection;
- 61 existing Visible repair tests;
- 25 actual write-governance tests;
- 32 server Artifact Repair tests;
- 9 Harness write-preflight tests;
- 19 Core mutation-governance tests;
- 16 server experiment tests;
- 6 AI repair-contract tests;
- 5 request-bound tests;
- 2 repair-memory tests.

The multi-generation orchestration tests use scripted proposals and judgments, real in-memory Blob/ZIP bytes, actual server materialization, hash checks, and existing Harness repair state machines. They are not live-model or production-storage evidence.

Focused TypeScript contract/Core/Harness lineage check passed with `tsconfig.p2c-contracts.json` after removing an unused type import from the lineage module.

The full direct `tsc -b` invocation remains blocked by existing environment/dependency and type-definition issues (including missing dependencies, Chai/Vitest assertion typing, YAML API typing, and frontend JSX types). The prior diagnostic log contains 9,703 lines including repeated/cascading errors; this is not a count of independent product defects. Logs: `artifacts/validation/p2c-full-typecheck.log` and `p2c-full-typecheck-summary.json`.

`pnpm architecture:check` remains blocked because ESLint is unavailable in the isolated environment. No dependency installation, dependency-version changes, lockfile changes, commit, merge or deployment was performed.

## Remaining work

The P2-C focused acceptance is complete. Before merge/release, restore the full dependency/type environment within the agreed boundary and pass full project typecheck, lint/architecture checks, and production build. Separately run live-model experiments with budgeted real AI and production-like artifact storage. Native Office internal-part/cell governance and local browser-only write enforcement remain outside this implementation slice.