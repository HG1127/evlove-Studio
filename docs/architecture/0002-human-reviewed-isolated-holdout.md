# ADR 0002: Human-confirmed isolated Holdout after Original Safety REVIEW

- Date: 2026-10-15
- Status: approved by the project owner for controlled continuation; implementation requires exact-commit CI and separately authorized production release.
- Human decision: question item call_191dac370a7d496aaeaabdf78867b301, answer “批准人工复核继续，保留 REVIEW”.

## Observed problem

A normal new Workflow correctly refuses to reuse an Original Baseline with partial SYS-INTEGRITY. It therefore measured a new Baseline before dispatching the persisted Experiment checkpoint. That independent result was a valid Safety REVIEW. It must remain REVIEW. Cache expiry was not the established cause; the partial hard-gate evidence was.

The real frozen winner P1-03 has actual changed bytes and completed Experiment evidence. Earlier same-paper Hidden execution exists, but both independent assessments failed JSON parsing. No Gate F or accepted download was established. Retrying the valid Baseline verdict for PASS is prohibited.

## Decision

Add a separate, explicitly confirmed human action and dedicated Workflow for this fixed-file case. It collects fresh same-paper Current/Candidate evidence from the already frozen winner. It never makes the Original REVIEW reusable as a normal Baseline or restores an old private diagnostic carrier.

This is the narrow approved exception to automatic pause after Original REVIEW: a governed human may authorize the next isolated measurement, while the REVIEW, its reasons, prior failed paper, all contract thresholds and protection requirements remain. It is not a Safety verdict or acceptance override.

- Contracts validate exact Mission version, Baseline SHA, full input SHA, paper SHA, snapshot-set SHA, Original/frozen bytes and model-route fingerprint.
- Only governed human operator/admin identities may confirm. Service and temporary protected-deployment identities are rejected.
- The existing owner reservation, compare-and-swap, stable Job key, SDK Run binding and single dispatch semantics apply. Unknown starts stay unknown; the same request key can recover an acknowledgement.
- Before dispatch, an immutable Event preserves the complete Original REVIEW, prior Hidden result, checkpoint and explicit human confirmation.
- The dedicated Workflow calls fresh Hidden and conditional Gate F as separate top-level SDK steps. It never calls Baseline, diagnosis, planning or Candidate construction.
- Each Baseline/frozen-file/Original/paper scope consumes one confirmation Job. A fresh request key cannot create another judgment, including after a lost save or audit acknowledgement; use the original key to inspect/recover the same Run.
- Hidden starts with no reusable prior execution or assessment. Both arms use the same unchanged paper. A new valid REVIEW/FAIL pauses; no automatic step retry pursues another verdict.
- Gate F requires THIS Run's private fresh output, unchanged full generation, source/Candidate physical reads, unchanged model route, live observation TTL and both new independent Safety PASS results. Existing Hidden, protection, per-criterion thresholds (92 in this Mission) and acceptance settlement remain.
- Automatic targeted repair is disabled for this action. A different Candidate needs its own normal evidence and authority.
- Original REVIEW is unchanged even if fresh Hidden/Gate F later passes. Gate F only evaluates the new actual evidence.
- The action stops before release and does not claim exact accepted-file download/reopen has happened.

## Scope and consequences

The first supported case is one uploaded HTML Original, no prior Champion, round one, a completed independently evaluated frozen Experiment winner, and a paused Original REVIEW. Other Targets, schedules, prior Champions, active/unknown controllers, downstream Safety REVIEW/FAIL, pending approvals and existing budget/round/time limits fail closed.

No migration, production Cron, manual Job repair, user key change, Git publication or production deployment is part of this decision. A main merge currently causes automatic production release; do not merge a new commit until its specific production release is authorized.

The Harness acceptance repair port becomes optional. Existing normal callers still supply it and retain their behavior. Only this dedicated same-file path omits it. No held protection-authority work is imported.

## Alternatives and rollback

Keeping the automatic pause is the default for unapproved records. Repeating Baseline until PASS, changing REVIEW to PASS, restoring an old diagnostic carrier from public DTOs, changing the paper/92 threshold, or giving normal /start a bypass were rejected because they change the safety or evidence boundary.

Owner: project owner (human decision above); implementation: this isolated codex/reviewed-holdout-resume branch. No schema migration is required. Removing the dedicated endpoint/UI/Workflow restores the original pause behavior; already saved REVIEW, prior paper, approval Events, actual step results and Job/Run identities must remain. Existing ordinary Gate F callers continue to supply their repair port.
