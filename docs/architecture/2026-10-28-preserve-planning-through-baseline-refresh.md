# Preserve committed planning through a fresh Baseline

Date: 2026-10-28

Status: accepted mechanism; actual accepted delivery and the three real effects remain unproved.

## Measured failure

Confirmation 26 used pushed `2eac937`, MiniMax-M3.1-Flash and the existing provider/key, with a preregistered 300-second request timeout inside the unchanged 30-minute trial. Its real planning response took 203.477 seconds and produced one queued Candidate. The independent final paper had been committed 58.838 seconds before the first planning request. Exact wire replay confirms the registered C21 negative observations reached that request, without independent final inputs.

At `2026-10-28T10:46:38.857Z`, the Baseline was 620,386 ms old. The existing live-observation limit is 600,000 ms; HTML browser cases are included in that policy. Reuse correctly failed freshness while the measurement fingerprint, Original references, Candidate and final paper remained unchanged. A fresh Baseline then reset checkpoint `plan` to `baseline`. The next step called problem analysis again instead of constructing the already committed Candidate. The bound run was preventively cancelled before another plan or file mutation. All eight local requests settled; no frozen Candidate, Visible/Hidden/final result, output or Lesson was produced.

The defect is loss of planning progress during observation refresh. Extending the live-observation TTL or treating every external-runner case as immutable would weaken an unrelated protection and is unnecessary.

## Decision

Harness recognizes a committed, unexecuted Plan before refreshing Baseline evidence. It requires the same round, existing measurement fingerprint and scoring route, ready prior evidence, Experiment Ready approval, a unique bounded selected population, queued unexecuted Candidates, matching historical-feedback receipts and the original valid, unconsumed independent final paper. Incomplete or changed bindings pause before external work; they cannot silently obtain another planning slot.

The existing fresh measurement still executes and settles normally. A successful refresh preserves the exact Plan checkpoint, Candidate identities, independent paper and existing budgets, while using the newly measured Baseline for subsequent comparison. Changed or missing physical Original references pause with the fresh observation retained. A failed measurement also pauses without replacing Candidates or the paper. Existing frozen-experiment recovery keeps its separate verification path.

No timeout, round, candidate, repair, scoring, safety, freshness, Hidden or final acceptance limit is relaxed. This adds checkpoint orchestration within Harness; Core remains independent of infrastructure, and no technology-stack exception is introduced.

## Verification and limits

Tests exercise an expired external observation followed by one fresh measurement and a handoff to Experiment without any problem/diagnosis/plan call. Negative cases cover changed inputs/routes/paper, spent final evidence, missing/duplicate selection, incomplete memory binding, approval changes, Judge failure and changed physical Original references. Existing freshness and frozen-recovery tests remain required.

A source-bound replay of the actual C26 revision 5/6 states verifies the 620,386 ms age, otherwise matching input identity and unchanged Original/Candidate/paper. At the original observation time, the new guarded handoff selects Experiment with zero new generations. This is explicitly counterfactual, performs no model/isolated execution/remote write, and leaves the sealed failed Mission unchanged. It does not prove a new accepted SOP, actual user benefit or causal transfer.

Final verification passes 256 related tests in 17 files, all 11 Runner tests, architecture/changed-file lint and the full TypeScript/production build. Early new-fixture failures (missing the existing three-criterion minimum and a mismatched observation mode) were corrected in the synthetic tests, without weakening runtime contracts. The historical trial remains cancelled; there is no new live Candidate-construction or acceptance result for this mechanism.
