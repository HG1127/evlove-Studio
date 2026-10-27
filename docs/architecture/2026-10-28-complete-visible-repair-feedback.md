# Keep mixed Visible failures in the same bounded repair scope

Status: implemented for validation, 2026-10-28.

C17's initial Candidate failed workflow closure at 89 against a minimum of 92. Its other original user goals still passed their absolute minima but regressed on the same Visible paper: understandability 94 → 89 and configuration detail 89 → 87. The v2 repair selector returned immediately after finding the absolute failure. The actual reservation therefore included only workflow closure. Its sole repair reached 96/93/94 and gained 2.7 overall quality points, but understandability remained below the original 94. The complete-user-goal Winner guard correctly rejected it.

## Decision

Add the explicit opt-in policy and claim version `experiment-visible-repair-v3`. It combines measured absolute failures with separately verified regressions of original, non-protected user goals under `all-user-goals-v1`. Comparative feedback requires complete, unique, same-suite paired evidence for every original user goal; missing, partial, duplicated or misbound evidence grants no comparative target. The union follows rubric order and includes each criterion once.

V3 claims require an explicit classification: absolute, relative or combined. The exact scope, classification and policy enter the existing reservation fingerprint. Before mutation, Harness rechecks them, the complete archived Visible report, exact physical parent, revision claim, original paper and existing limits. Core revalidates the complete running feedback scope; it accounts for the already recorded claim estimate without inventing a second cost allowance. The backend distinguishes each relative row from an absolute failure. Passing scores remain PASS, with their actual paired scores supplied separately. All feedback stays within the same shared repair debit and existing pre-write construction correction.

Every repaired file remains a new frozen Candidate and must rerun complete Visible → ordinary Hidden → the unchanged independent final → Gate F. A remaining user-goal regression still blocks promotion even if the absolute minima and weighted improvement pass. Executed final feedback remains ineligible. No threshold, budget, Candidate count, time window or Safety rule changes.

Strict v2 records retain their old two-value classification schema and selection semantics; v1 inline history is unchanged. V3 is a separate storage discriminator and must not reinterpret or resume C17's terminal v2 claim. Generic JSONB storage needs no migration. Readers must support v3 before an explicitly selected v3 trial starts. The default policy is unchanged.

## Validation and limits

Static replay of C17's immutable reservation checkpoint reconstructs the exact pre-debit state at its original snapshot clock, with network access disabled. V2 still selects only workflow closure; the opt-in v3 union selects all three measured failed/regressed user goals. It changes no real Mission, scores, paper or budget.

Tests cover version isolation, truthful per-criterion backend payloads, complete paired evidence, claim tampering, archive-before-call, one shared debit, original deadline, frozen-child recovery without regeneration, and rejection of a child that still regresses. The old legacy and final-acceptance tests remain required. These checks establish scope and execution plumbing, not a successful future model repair, actual business benefit or causal Lesson transfer.

Final verification passed 250 tests in 13 related files, 11 Runner tests, architecture check, changed-file lint and the full TypeScript/production build. A first cost-boundary fixture incorrectly assumed a nonzero estimate; its two failures remain logged, and the fixture now explicitly supplies a claim estimate above the recorded campaign amount. The unchanged guard then rejects it. The new reader also reads the actual sealed C17 v2 Mission with the exact original formal hash and one-criterion repair scope. Final-code static replay selects the three-goal v3 union while retaining v2 selection, with no network access or real retry.
