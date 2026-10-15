# ADR 0004: Explicit recovery after a reviewed pair has no valid verdict

Owner: backend Mission control maintainer. Date: 2026-10-15. Status: isolated implementation; exact-commit CI and a specific production release approval remain required.

## Context

The actual approved P1-03 Run wrun_01M4ZHNG6M9D9SAN74299RF3AA completed its SDK execution and recorded nine raw Current and nine raw Candidate observations. Both independent JSON results were unusable after the one permitted correction. There was no new valid Safety verdict. Original Baseline REVIEW, the changed frozen Candidate, all failed records and the 92-point threshold remain. Ordinary new request keys correctly cannot start another reviewed judgment for this scope.

A changed, tested output policy needs a governed fresh measurement path. Replaying ordinary start would repeat Baseline. Modifying the old Job or Run would corrupt history. Repeatedly requesting another judgment under the same scoring version would evade the original pause.

## Decision

Keep ordinary reviewed dispatch unchanged. Only an explicit recoverInvalidOutput=true GET constructs an additional recovery proposal. A new authenticated human POST must include exactly that proposal, preserve all failed attempts and acknowledge that no valid verdict was produced. Service identities remain forbidden. Each existing attempt in the same reviewed scope must be completely verified; missing, ambiguous or active execution refuses recovery. The current scoring route must differ from every previous attempt, so another key on the same version remains blocked. Same-key lost acknowledgements reuse the existing Run. If audit append failed before dispatch, only the same matching queued reservation may finish with its original intact recovery proof; its unstarted Job is excluded from historical measurements. A dispatching/unbound result remains unknown and cannot start again.

The server reads the private Workflow World, requiring the exact reviewed workflow, one completed first execute step, matching Run/step input and output, no continuation and no Gate F step. All metadata pages must be complete. A private in-memory observation receipt rejects modified or serialized/public SDK-looking DTOs. SDK failures are sanitized; private serialized inputs or credentials are never returned by the preview.

The completed step corroborates its deterministic immutable result Event: the existing execute implementation appends the result, verifies physical/generation bindings, saves it and reads it back before returning. Its private input must agree with the old Job and approval. The endpoint similarly committed the admission Event before dispatch. Event data alone cannot authorize recovery; the public Event API cannot manufacture a completed private step or the local observation receipt.

The corroborated validation must contain both complete literal Hidden answer sheets, no evaluation on either arm (including prior evaluation/snapshot), a strict completed-JSON failure with both initial/correction diagnostics, and the approved physical binding. Any valid PASS, REVIEW or FAIL blocks this invalid-only path. The current stored validation must equal the corroborated result of the bound owner Run.

Reconstruct the original full input hash in a temporary local projection using only the recorded prior validation/checkpoint/wait and the finite stage enum. The original Baseline and complete acceptance contract must hash to the old approved digest. The projection is never written. Changed requirements, protection, thresholds, papers, files or unknown inputs fail closed. The actual saved SOP record reconstructs exactly at its original baseline stage; this local audit does not constitute private SDK proof or execution permission.

After a second physical/input/route preview and CAS owner reservation, dispatch the existing zero-retry reviewed Workflow. It clears only its local fresh Hidden working state, executes both arms anew, persists new real verdicts, and can reach Gate F only through its existing private fresh-result carrier. Frozen bytes, original REVIEW, whole protection, scores, TTL, Gate F and identical accepted delivery requirements remain unchanged. No old Job is repaired.

## Alternatives and rollback

A normal duplicate start, public error-string override, reusing old raw measurements, a forged Event, relaxing the parser, lowering scores or rejudging a valid REVIEW/FAIL are rejected. The failure description is used only after private completion and immutable-record corroboration; it grants no authority by itself.

This is an additive optional request/preview field, with a versioned recovery declaration. Existing requests retain their behavior. No database migration, production config or secret change is required. Reverting the feature restores the ordinary one-scope restriction; historical new Jobs/events remain truthful records. A release or rollback requires the precise source tree and full CI. No production call or real Mission acceptance is inferred from synthetic tests.
