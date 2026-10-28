# Preserve verified user-goal failures at the evidence-only route

Date: 2026-10-28

Status: accepted; no successful model improvement or transfer is certified.

## Actual witness

Confirmation 21's repaired frozen file had three verified, same-Visible-paper regressions, while passing all three absolute minima. Its protection evidence was incomplete. `candidateWinnerDecision` correctly rejected it, but the separate evidence-only classifier inspected absolute failures only. It therefore selected `pendingEvidenceCandidateId`, labelled the Candidate `winner` and sent it to ordinary Hidden. This is an actual routing defect; it is not proof that independent final or delivery could be bypassed.

The exact Job/Workflow was cancelled before independent final execution, preserving both Candidates, the consumed 1/1 repair, all assessments and the original deadline. Ordinary Hidden had completed with a `release` recommendation, but its closure score also regressed 96→95. That recommendation is not full-goal acceptance. All three real-effect requirements remain unproved.

## Decision

`experiment-evidence-admission-v2` introduces a separate pure Core qualification using the existing `all-user-goals-v1` comparison. The legacy `experimentEvidencePendingOnly(evaluation)` remains an absolute-failure/evidence classifier; its meaning and historical serialized records are unchanged. It is insufficient on its own to admit an opted-in full-goal Candidate.

The new qualification rejects a verified paired user-goal regression even when other goals/protection are unknown. It also rejects a complete measured full-goal gain below the existing one-point threshold. Unpaired, unverified or duplicate evidence must not be invented as a measured regression. A genuinely improving or not-yet-measured Candidate can still retain exact bytes for evidence recovery.

Harness applies this qualification before selecting a pending Candidate, and again before any Storage/model/runner work at the Hidden entry for an existing pending checkpoint. The second guard uses the stored Visible comparison suite and Baseline where present, preserving all existing Validation records when it stops. This prevents an old pending ID from bypassing the new selection guard. No failed record or final paper is rewritten, rejudged or reissued.

A provisional evidence-only Candidate stays `draft`; only an actual eligible Visible Winner receives `winner`. Backend execution identity includes the mechanism version so observation-checkpoint caches are not mixed across this changed execution route. No new acceptance threshold, AI retry, Candidate, repair budget or window is introduced. Legacy goal-scope semantics remain unchanged unless the existing full-user-goal policy is selected.

## Evidence and limits

Core tests cover absolute-pass regression with missing proof, insufficient complete gain, one known regression among pending goals, legitimate provisional improvement and unknown comparisons. Harness tests exercise complete experiment selection and cached-Hidden admission, prove zero downstream calls on rejection, preserve historical Validation and keep true missing-evidence recovery working. Read-only replay rejects the actual C21 witness under the new qualifier while retaining C17–C21 formal hashes. These are admission-mechanism checks, not a successful new model trial.
