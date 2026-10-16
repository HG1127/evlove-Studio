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

## Encrypted World observations

A real read-only inspection of the old production Run found encr input/output. The initial 55d2fff reader used synchronous display hydration, which leaves encrypted bytes untouched. Its structural CI does not prove production recovery capability. The failed real read and a failing SDK-generated synthetic encrypted regression are preserved; no production key was retrieved locally.

Declare the already locked @workflow/core 4.8.9 as a direct dependency, matching workflow 4.8.9. Use its public serialization-format/encryption exports for isEncryptedData, hydrateDataWithKey and a nonextractable decrypt-only CryptoKey. Existing package and snapshot selections are retained; no unrelated version is upgraded. The workflow facade in this installed version does not expose the async key-aware hydration helper.

Only the backend resolves a derived per-run key through its configured World after validating the completed Run, exact execute-step metadata and original deployment identity. Passing the original deployment ID is mandatory for cross-deployment reads. The key remains in backend memory and never appears in a response, Event, log or persisted proof. The platform's deployment key and model Vault are unchanged. Plain SDK frames request no key. Encoded I/O is bounded to 4MiB per field and key resolution to 15 seconds. Missing/invalid keys, authentication-tag errors, expired/malformed payloads or unavailable access fail closed without a model call or replacement Run. These limits do not change the model correction's existing 2MiB/4MiB constraints.

Synthetic tests use the official SDK serializers and encryption with a fictional key; no real key is exported into the local test/CI environment. Actual backend cross-deployment decoding must still be observed after the approved release before any fresh Mission dispatch.

## SDK runtime Step envelope (2026-10-16)

The approved e8d1ce7 production preflight returned a safe 409 and started no replacement Workflow or paired judgment. Both physical file hashes remained unchanged; an independent synthetic call using the saved MiniMax connection passed. The failing backend observation stage remains unproven from that refusal alone.

The pinned core4.8.9 runtime/suspension-handler serializes an object containing args, closureVars and thisVal. The initial private-reader fixture incorrectly passed a bare argument array to the SDK serializer; that tested encoding but omitted the real runtime envelope. The new regression reproduces its refusal using the actual documented runtime shape before the fix. Validate exactly one ReviewedHoldoutRunInput inside args and prohibit captured scope, a bound receiver and unknown envelope fields for this known imported step; return only the validated argument as the existing private evidence input. Bare arrays are rejected. Workflow/Run/step identity, first completed attempt, paging, private in-memory receipt, immutable corroboration and every acceptance gate remain mandatory.

The World cross-deployment key provider returns a Node Buffer. Buffer.slice shares provider-owned memory, so clearing that apparent copy also cleared the provider Buffer in the old codec. A second failing regression preserves this finding. Uint8Array.from now creates a real owned copy before import; only that copy is cleared. No real key was retrieved in the local reproduction.

Safe diagnostic codes describe only locally selected observation stages, including input, output and key-read failure. They never contain provider messages, private serialized values, credentials or a cause; public DTOs/provider errors cannot mint the error brand or a recovery proof. The code grants no retry or acceptance authority. Actual backend decoding and all real main-flow acceptance remain unverified until the new exact tested source tree is approved, delivered and measured.

## Alternatives and rollback

A normal duplicate start, public error-string override, reusing old raw measurements, a forged Event, relaxing the parser, lowering scores or rejudging a valid REVIEW/FAIL are rejected. The failure description is used only after private completion and immutable-record corroboration; it grants no authority by itself.

This is an additive optional request/preview field, with a versioned recovery declaration. Existing requests retain their behavior. No database migration, production config or secret change is required. Reverting the feature restores the ordinary one-scope restriction; historical new Jobs/events remain truthful records. A release or rollback requires the precise source tree and full CI. No production call or real Mission acceptance is inferred from synthetic tests.
