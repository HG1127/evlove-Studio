# P2-B · Parent-bound artifact write governance

Date: 2026-11-11
Workspace: D:\Downloads\evlove-studio-evolve-p0
Branch: codex/artifact-evolution-governance-p0 (uncommitted changes above 60608f7)

## Delivered scope

The server's existing materializeServerCandidateArtifacts and applyServerCodebaseOverlay paths now enforce an explicit, trusted write policy for governed text targets and ZIP/codebase entries. No second repair lifecycle, Candidate store, optimizer, or acceptance gate is introduced.

SourceArtifact.mutationGovernance is an optional, versioned configuration:

- version: artifact-write-governance-v1
- parentSha256: SHA-256 of the exact approved current text/ZIP parent bytes
- policy: the existing ArtifactMutationPolicy (allowedPaths, protectedPaths, allowDelete, maxChangedFiles, maxFileBytes, rejectNoop and preservation attestation policy)

Policy comes from Mission/source configuration, never from a generated artifact response. A model-supplied policy object cannot expand its permissions. A trusted intake/approval flow must provision this configuration; this change does not add that UI or silently migrate old Missions.

## Layer ownership

- Contracts: versioned source configuration and unambiguous portable relative paths.
- Core: validateArtifactWriteSet is shared by P0 proposal validation and actual byte preflight. It owns allowlists, protected subtrees, case aliases, deletion, size/count limits and no-op decisions.
- Harness: preflightArtifactWrite receives byte hashing and parent-file readers through ports. It compares the approved parent digest and computes per-file hashes/sizes from actual bytes. It performs no storage writes.
- Server adapter: ZIP decoding, ZIP entry metadata/symlink checks, and calls to the existing persistence pipeline remain here. The same parent byte buffer is used for preflight and ZIP mutation.

## Write order and guarantees

All target outputs are prepared and validated before the first Candidate Blob put. A forbidden later file therefore prevents an earlier valid target from being persisted. Parent SHA mismatches, protected files/subtrees, missing writable permission, unauthorized deletion, duplicate/case-aliased paths, file/directory conflicts, platform path aliases, excessive file sizes/counts, and unchanged ZIP updates are rejected.

The guard is also checked for a governed keep-parent ZIP; it cannot bypass a stale parent binding by claiming to preserve it. Governed output root filenames must retain the trusted source name.

This is validation atomicity, not a distributed storage transaction. A storage outage after preflight can still leave orphaned blobs under the existing persistence/cleanup semantics. No such blob is automatically a Champion.

## Coverage and limitations

- Enforced: explicitly governed server-side text artifacts (including text code/HTML through their existing validators) and ZIP/codebase entries.
- Legacy sources without mutationGovernance retain their existing behavior. They are not represented as governed by this policy. A malformed/null policy is rejected, not downgraded to legacy.
- Governed native DOCX/PPTX/spreadsheet targets currently fail closed with ARTIFACT_WRITE_GOVERNANCE_FORMAT_UNSUPPORTED. Their previous ungated renderer routes are not claimed to have new internal-part/cell governance.
- After a new parent is accepted, a trusted workflow must bind policy to its new byte hash before another governed generation. A model cannot rebind the hash itself.
- This change does not wire new controls into the local browser-only repair path, add approval UI, or prove continuous multi-generation autonomous improvement.
- Capability-preservation declarations are not behavioral proof. Visible regression tests, hidden validation, independent final holdout and Gate F remain necessary.

## Validation performed

Vitest: 109 passed across seven test files (0 failed). This includes 34 new write-boundary tests (9 Harness and 25 actual materializer tests), the previous 59 P0/P1/P2 tests, and 16 existing server materialization tests.

The tests call the real materializer and write guard with real in-memory ZIP/Blob bytes; model and persistence services are test doubles. They are not a production AI run or production Storage transaction test.

Machine-readable result: artifacts/validation/p2b-tests.json

Focused contracts/Core/Harness TypeScript check: passed with tsconfig.p2b-contracts.json.
Git diff whitespace check: passed.

Whole-project architecture check was attempted but could not run because the isolated environment could not resolve eslint. Standard project build was attempted and failed to resolve the tsc command entrypoint. Dependencies were not installed and lockfiles were not changed. These remain merge/release blockers; focused tests are not a substitute for a full build.

## Commands used

```text
node node_modules/vitest/vitest.mjs run --config vitest.p2b.config.ts --reporter=default --reporter=json --outputFile=artifacts/validation/p2b-tests.json
node node_modules/typescript/bin/tsc --project tsconfig.p2b-contracts.json --pretty false
git diff --check
```

No commit, main-branch merge, production deployment or dependency installation was performed.
