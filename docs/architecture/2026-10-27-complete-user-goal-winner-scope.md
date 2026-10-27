# Explicit complete user-goal scope for Visible Winner selection

Status: accepted for implementation; opt-in only. No existing Mission is migrated or reopened.

## Measured problem

Confirmation eight retained a Visible Winner whose `coveredCriteria` omitted the original understandability goal. The repaired file passed the absolute minimum but declined from 96 to 92 on that goal. Its declared focus improved 1.2 points while global improvement rounded to zero. The original three user-command goals, using the same stored scores and weights, instead changed by −0.334722 points. Ordinary Hidden subsequently held the Candidate; independent final was not executed, and no delivery or lesson resulted.

The omission is a policy gap: a Candidate's own design description can narrow which user goals count toward its focused improvement. It is not evidence that the model actually addressed the omitted goal. The historical Winner and failed acceptance remain authoritative under their registered policy.

The separately authorized metadata diagnosis is private Artifact `sop-confirm8-goal-focus-81c7401467ee1cdee96dfb1d`, SHA-256 `81c7401467ee1cdee96dfb1d30f8a8b3accc5065faec267caaf1a0661dfb17f6`, 2,951 bytes. Readback and all 75 ledger entries were verified without changing the formal Mission hash `9af8019e5c38a93cf3bf1a888bdb41872f8ec9e903f084fdf4e3713348a90939`. This Artifact contains no source body or independent-final questions.

## Decision

Contracts adds optional `experimentPolicy.winnerGoalScope = "all-user-goals-v1"`. Absence retains existing Winner rules and fingerprints exactly. New registrations must explicitly choose this policy before planning and reserving the independent final paper; it is not a default or a reinterpretation of historical trials.

For an opted-in Mission, Core derives the Visible focus from every original `source = "user-command"` criterion without `protectedConstraint`. A Candidate's `coveredCriteria` remains a model description and cannot remove a required goal. The added policy requires:

- A nonempty, uniquely identified user-goal contract with positive total weight.
- Verified, non-demo baseline and Candidate scores for every goal, without duplicate criterion identities.
- Complete case references matching all current Visible cases mapped to that criterion, with no missing, repeated or foreign case IDs. Ordering does not matter. Missing evidence stays pending.
- No measured decline on any original user goal, including goals with zero individual weight.
- At least one point of weighted improvement across the complete user-goal set. Gains on system criteria and reduced hard-gate failures do not waive these additional constraints.

The existing absolute minima, Safety, protected gates and global/focused Winner checks also remain required. This is an additional, stricter scope policy for new trials, not a lowered acceptance threshold. Winner status remains provisional and does not authorize delivery.

Core owns deterministic scope, paired progress and decision rules. Harness supplies the scope to Plan through injected AI ports. Backend composition supplies it to initial construction and targeted repair, along with truthful paired progress from Visible or the bound ordinary Hidden report. These contexts contain criterion requirements and numeric/case identity evidence, not the independent-final paper. Existing full-body/HTML transport permissions continue to apply independently.

Visible repair v2 can route a proven regression of a formerly omitted user goal through its existing one shared Visible/Hidden repair allowance. It preserves the absolute PASS, archives the full original report and persists the existing revision claim before AI. Missing or incomparable evidence does not become a fabricated failure or a new repair opportunity. No new retry budget or Hidden repair mechanism is introduced.

Scoring-input, artifact-evidence and independent-final contract fingerprints include the new scope only when present. Existing repair claims already bind the complete experiment policy. Changing scope invalidates those bindings and cannot reuse a reserved mutation under a different policy. Existing cancellation, deadline, same-byte acceptance and 23-node closed-loop boundaries are unchanged.

## Evidence and limits

The local replay `confirm8-complete-user-goals-local-replay.json` uses the sealed actual C8 scores. It reproduces the complete historical Winner decision, compares all three legacy fingerprints against the preserved `bfed67a` source, and verifies that the opt-in counterfactual is rejected for the understandability regression. Both Visible and ordinary Hidden goal pairs have complete mapped evidence. The source record and frozen files remain unchanged. The replay performs zero provider requests, Sandbox executions or remote reads/writes; it is not a new formal evaluation or a repaired Candidate.

Connected tests cover omitted-goal repair reservation, report archive, persisted claim, one shared debit, exact frozen child identity, policy-tamper rejection before AI, default compatibility, planning/build/repair context and final-question exclusion. Boundary tests distinguish missing/duplicate/wrong-paper evidence from measured failures and prevent cross-goal or system gains from compensating a user-goal decline.

Release checks: 283 related tests across 17 files, all 11 Runner tests, TypeScript/production build, `pnpm architecture:check` and changed-file lint passed. These are engineering checks using synthetic/injected data and the labelled offline replay; none is a paid real confirmation or human task observation.

No current Mission enables this policy. The pending paid-trial authorization names `bfed67a`; its exact tracked source and compiled server are preserved separately. That authorization must not silently substitute this new policy or implementation. A future trial needs its own explicit registration, immutable contract and applicable resource authorization.

This change does not prove a corrected model output, real user task benefit, monetary cost improvement or causal lesson transfer. Those three effects remain subject to the existing real-evolution acceptance protocol.
