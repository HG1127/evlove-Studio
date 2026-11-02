# Wire full confirmation admission into registration and execution

Status: accepted. This is an incremental composition change; dependency direction is unchanged.

Full confirmation previously had a read-only Harness checker but no production registration/start caller. New Missions may explicitly opt in with `experimentPolicy.confirmationAdmission`, version `full-confirmation-mission-v1`. Existing ordinary Missions and historical verdicts retain their original protocol; an ordinary run does not thereby become a calibrated full-confirmation trial.

## Trusted evidence boundary

The composition root reads `EVOLUTION_CONFIRMATION_TRUST` as `confirmation-server-trust-v1`: a bounded list of `{missionId, catalogArtifactId, catalogSha256}`. The client supplies only the matching catalog hash. A server-pinned Mission cannot omit that reference to bypass the gate. Invalid trust configuration fails closed. Neither an `approved: true` field nor a client-selected Artifact can establish trust.

Each `confirmation-evidence-catalog-v1` binds workspace, Mission input scope SHA, exact original files, v2 admission request, v3 calibration plan, observations, approval objects and application evidence. The server reads through the configured private ArtifactStore, checks metadata identity/size and actual content SHA, validates external JSON with Zod, then calls the existing Harness admission. The full rubric and paper are compared as parsed values in addition to existing fingerprints. Evidence is read only; no schema, RLS, storage-policy or database changes are required.

The pin is an explicit out-of-band registrar attestation: its operator must first verify genuine provider/request provenance, complete observations without selection, independent threshold labels/approval and the actual application scenario/log/fault evidence. Hashes and schema validity cannot prove independence or genuine execution. Do not install pins built from tests, synthetic scores, manual candidate controls or unverified local reports. The route does not provide a public endpoint to mint this attestation. No real qualified catalog is configured by this change.

Runtime source identity comes from the trusted deployment `VERCEL_GIT_COMMIT_SHA` or, for a local launch, `EVOLUTION_RUNTIME_COMMIT_SHA`. A local launcher must pin a verified clean checkout and its loaded process; setting this variable to an arbitrary HEAD is not runtime proof. The gate never guesses loaded code by reading the working directory. Model route identity is resolved from current server configuration without making a provider request.

## Registration and custody

The existing API creates a Mission before its FK-bound source Artifact upload. Registration therefore checks the exact approved raw UTF-8 inline bytes and declared source binding. It does not claim uploaded source custody. Execution separately requires stored canonical bytes, metadata and that Mission binding. Parsed text cannot certify a binary original in this strict registration mode; unsupported custody remains unavailable rather than passing. Other ordinary supported-format flows are unchanged.

The scope digest freezes goals, source identities, original criteria, Visible and Hidden suites, execution policies, target/model configuration and candidate/repair/window limits. It excludes the catalog reference itself to avoid a circular digest, runtime progress/results, business observations, and later server-owned final reservation. Hidden content is hashed locally for this gate and is not sent to the model. The independent final, exact artifact acceptance/delivery, real business benefit and Lesson transfer remain separate gates.

## Entry points and continuation

Checks run before Mission POST persistence, alternate PUT creation, generic Job creation and new Workflow start/browser probe. The legacy harness execution URL delegates to the guarded start route. Existing same-request start receipts can still be retrieved without a new probe. Workflow initialization, planning and action execution recheck the same frozen scope, so mutation/reconfiguration after registration cannot silently continue. Generic Mission PUT cannot add/remove/replace the reference or downgrade its paired protocol.

The new reference is opt-in for new full confirmations, not a retroactive reinterpretation of C44 or earlier trials. A calibrated admission never grants a new trial window, model budget, production promotion or technical acceptance. Generic AI utility calls do not establish full-confirmation eligibility.

## Verification and remaining limits

Route tests exercise the actual handlers and real Harness checker using explicitly synthetic, locally hashed evidence. Negative cases cover missing/untrusted pins, omitted policy, code/route/paper/source drift, absent/corrupt observations, approvals/logs, lost source custody and generic PUT/legacy entry points. Workflow tests verify rejection before AI, browser probes and writes. These tests verify wiring and refusal semantics; they are not real model calibration or a successful SOP trial.
