# Experiment Performance Contract · V2.8

## ExperimentPolicy

```text
mode: adaptive | full
finalistCount: 2..6
screeningCaseCount: 1..5
batchSize: 2..8
buildConcurrency: 1..4
batchArtifactRuntime: boolean
```

## Adaptive correctness invariants

1. Screening score is provisional only.
2. Screened-out candidates cannot become Winner.
3. Winner must complete full Candidate Artifact build.
4. Winner must complete full visible Eval Suite.
5. Hidden Validation remains a separate downstream Gate.
6. Batch execution must return one independent result per TestCase.
7. Missing batch result is explicit failure, never silently PASS.
8. Safety/Hard Gate failures are prioritized in screening.
9. Full mode remains available and bypasses Successive Halving.
10. Retry of failed experiment cases must ignore candidates intentionally removed by screening.

## Batch Target contract

A Target Adapter may implement:

```ts
runBatch({ project, testCases, variant })
```

The adapter must preserve:
- `testCaseId`
- per-case output
- per-case trace/evidence
- per-case verificationStatus

Batching is a transport/context optimization, not an evaluation semantic change.
