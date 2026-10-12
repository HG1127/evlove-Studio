# Direct model transport recovery handoff

## Scope

Branch: codex/ai-transport-recovery.
Runtime commit: 87b84338d4146bc4e58b9510c4eda90649cfa025.
Base: 3e47c9ef378d9b4f39a03de17ed5d8111cafac44.
Development checkout: D:/Downloads/evolution-os-smoke-temp/server-main-flow-recovery-build-worktree.

This increment addresses the model-availability recovery boundary of the real Mission flow. It does not accept the historical Mission or generate a substitute Candidate.

## Reproduced gaps

- Direct Chat/Responses calls rebuilt a transport error without its type/cause. A timeout or socket/DNS failure therefore escaped the capability-wait path and became an ordinary Step error.
- response.json().catch(() => ({})) swallowed a body timeout/socket loss after HTTP response headers; that failure appeared to be empty/invalid model output.
- Capability checks could consult current environment defaults rather than the already pinned route. Two tests reproduced both a false unavailable pinned connection and a newly added environment route being reported available inside an operation pinned to missing configuration.

The initial transport report has six failed and three passed tests. The pinned-route report has two failed and eleven passed. A subsequent workflow fixture also exposed the pinned-route inconsistency. Initial reports and logs are retained.

## Changes

The public Adapters HTTP helper performs one request and reads its body under the caller's existing AbortSignal. Known Node network/timeout causes and an abort caused by that same timeout signal produce typed, text-free availability errors. It never retries, changes endpoints, renews deadlines, or copies provider diagnostics/credentials into those errors. Arbitrary programming/decoder exceptions and non-timeout cancellation remain ordinary errors. Malformed JSON retains the existing HTTP-status fallback; successful task output still requires the existing Zod envelope and operation schema.

Backend Chat and Responses use this helper. The existing AI guard maps those typed errors to provider-timeout/provider-network-error. The existing governed API returns unavailable; the existing durable Step catches the capability error and persists its wait. Mock-storage integration tests execute the actual AI/probe/guard/Workflow code and check the unchanged Candidate, Baseline, stage, checkpoint, Job generation and safe persisted message. Replaced controls remain blocked; unknown exceptions cannot produce a fabricated wait or result.

Capability checks first honor the current AsyncLocalStorage pin, including a pinned missing route. Outside an active scope, the existing environment/Vault resolution is preserved. Scoring identities and evidence contracts are unchanged. Gateway is optional; this work targets the user's direct custom Base URL/model connection.

## Evidence and commands

Evidence files below are under D:/Downloads/evolution-os-smoke-temp:

- ai-transport-recovery-before.json / .log: transport regression before repair.
- ai-transport-pinned-before.json / .log: two pinned-route regressions before repair.
- ai-transport-recovery-related-a.json: initial workflow fixture failure, retained.
- ai-transport-recovery-final-summary.json: unique successful related files and exact report selection.
- ai-transport-recovery-source-hashes.json: eight runtime/test source entries, raw and normalized SHA-256.
- ai-transport-recovery-gates.json: final architecture, full lint and TypeScript/production build commands with actual exits.
- ai-transport-recovery-gates-initial.json / architecture-initial.log: initial test-format lint failure, retained.
- ai-transport-production-readonly.json: passive public GETs, with the initial network failure preserved.
- ai-transport-browser-observation.json: fresh browser inspection/recovery boundaries.

Focused tests use the installed Vitest CLI, maxWorkers=1 and D: TEMP/TMP. The final summary uses one successful report per unique file rather than double counting repeated suites. Local native HTTP tests reproduce response-body timeout and real socket interruption; all provider payloads/keys/files in tests are synthetic. The helper is in Adapters; Domain/Harness dependencies and Zod validation remain intact. No migration is required.

Final local validation: 19 unique files, 214 passed, zero failed/skipped. Architecture check, full lint and TypeScript/production build all exited 0. The final report selection replaces earlier reruns without double counting. Initial lint found two test-format newlines; the next build found an incomplete Response substitute. Both were fixed to real call/Response types and all final gates rerun; failed logs and exits are preserved.

## Integration and main-flow limits

The preceding runner recovery stack at independent candidate 95152c00e962509d90b2801c1f23abf942ae9d61 passed the CI chat's complete local gates: 328 files, 2668 passed, one explicit skip, Runner 23, architecture/full lint/build and compiled readonly UI; 419 output hashes unchanged. Its receipt is ci-runner-readiness-95152c0/verification.json. This receipt excludes this increment. Hosted CI, new production deployment and the real Mission remain unverified.

Fresh production GETs still identify deployed main/production e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9. Passive configuration reports saved-connection encryption and browser operator access unavailable. It does not read model keys or verify a model. These are recorded external follow-ups. No production secret, business Job, Cron, migration, deployment or user-file cloud execution was changed.

The current localhost:8000 page belongs to another application; it is not the prior Evolution preview and was preserved. Tabbit inventory was available, but both fresh project-page observations failed with a closed page/context during attachment/observation. Acquisition recovery subsequently failed before dispatch. The owned scratch tabs were closed and task finalization succeeded; user tabs were retained. No fresh Mission state, private model key, original bytes or accepted Candidate were read.

Real acceptance still needs a fresh authorized Baseline/diagnosis, actually changed frozen Candidate ID/hash, paired same-Hidden execution, Gate F and identical downloaded/reopened SHA-256. The original historical receipt and the synthetic/CI totals cannot substitute for it. Root hands completed commits to the authorized Git/CI chats and does not push main or deploy.
