# Workflow Run reuse: current execution World

## Verified increment

Runtime commit: `5b51fe6936094c2552d067df0f3c68227d454726` on `codex/ai-transport-recovery`, based on `a22a76723082b99ea05d9cfb772dd46f47469657`.

`POST /api/evolution/start` previously replayed a stored Run ID without consulting the active Workflow World. A database binding created in another local directory or deployment could therefore return a successful queued receipt even though that execution environment did not contain the Run.

Normal idempotent replay, scheduled replay and fresh-measurement replay now check the SDK's `Run.exists` before returning the stored receipt. Missing Runs return 409; lookup failures and invalid SDK boolean values return a safe 503 that requests retry with the same idempotency key. These checks do not start, cancel or repair a Run, update Mission state, bind a new Job or append events. Existing successful replay responses are preserved.

The presence helper validates the SDK boolean with Zod. The installed SDK's `exists` getter requests metadata with `resolveData: none`; this check does not read `status`, input, output or decrypted payloads. Presence is not proof that a worker is live. The response's existing `queued` status remains an idempotent receipt and must not be interpreted as execution evidence.

## Local verification

- Before repair: all 12 new replay regressions failed. The raw report is retained.
- After repair: 12 distinct related test files, 119 parameterized assertion rows passed, zero failed or skipped. Two disjoint report batches run with `--maxWorkers=1`; repeated display names within existing parameterized tests are counted as distinct rows.
- `pnpm architecture:check`, `pnpm lint` and `pnpm build`: exit 0. The build includes TypeScript, Vite, Nitro and Workflow compilation.
- Six modified source/test file hashes match the runtime commit and the tested bytes.
- Actual SDK-to-compiled-backend transport with generated IDs reached `initializeWorkflowControlStep` and recorded `step_started`. Its database, model and Sandbox were disabled; the isolated World and owned preview were stopped. This proves transport, not real Mission execution.

Commands, raw reports, retained first aggregator mistake, gate logs and source hashes are in `D:/Downloads/evolution-os-smoke-temp/workflow-run-reuse-local-verification.json`. Actual SDK transport: `workflow-run-reuse-local-sdk-wire-receipt.json`. Additional compiled readonly UI evidence, when complete, is `workflow-run-reuse-preview-receipt.json` in the same evidence directory.

## Existing runtime observations and remaining boundaries

The installed official Vercel CLI is authenticated and can read the linked project. Earlier standalone Workflow CLI authentication failure is not evidence that the official CLI login is missing. The two stored control Run IDs have actual records in the primary checkout's local `.workflow-data`; both retain running metadata and only `run_created`, `run_started`, `step_created` events. Their initializer Steps are pending with attempt 0. No live worker was verified, and no old Run was resumed, copied, cancelled or repaired. Those metadata receipts exclude user inputs/outputs.

Production readonly GETs before and after the passive readiness request at 2026-10-10 07:38 UTC both identified `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`, main/production. They do not verify this local increment. The previous complete independent local CI receipt for `271a11e166e8da97e5c022384ba4f503b0c65751` also excludes this increment; a new integration SHA requires its own full gates. Git/CI handoff owns integration, hosted validation and deployment.

The real Mission remains `project-1790480873333`, last readonly revision 29, Plan. Its original SHA-256 is `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`; changed frozen `cand-P1-001` is `9a616d1a919e18f6f6e606cee02ca9f9617e680c2875bf888fca07f8e863f068`. Existing model and Sandbox synthetic health can run. Fresh user-file export approval remains pending. Fresh execution provenance, Experiment, same-Hidden paired validation, Gate F and matching accepted download/reopen remain unproven. No product acceptance, production mutation, secret change, Cron or migration occurred in this increment.

## 2026-10-10: independent CI recovery-fixture follow-up

Independent complete CI on `643c072aee77ffcaf213c7a31812c031f07f1030` finished **FAILED**: 332 files, 2711 passed, one failed, one explicit skip. Initial batch 29 terminated with a native Zone Allocation memory failure and omitted `plan-grounding.test.ts` despite JSON `success: true`. Its entire original ten-file batch later passed unchanged; both the first failure and recheck remain retained. Architecture, lint, build, Runner23 and compiled readonly UI passed, but do not override the unresolved suite failure. Immutable verification receipt: `D:/Downloads/evolution-os-smoke-temp/ci-run-reuse-643c072/verification.json`, SHA-256 `4539b1423dfa6c1f193d37d050e5ac523a3fb11b5c02d3d0528f691ca165fb7e`.

The remaining failure was the Experiment lost-acknowledgement integration fixture. It reset `getRun` without modeling the SDK `exists` getter and forced every H3 response to HTTP 200. The new metadata guard correctly returned 503, which that inaccurate HTTP fixture then misreported as a malformed successful receipt.

Test-only commit `48262f3f8af1b2553bbee11925390eba74124607` models presence from a set containing only Run IDs actually returned by its mocked SDK `start`, and propagates `event.res.status`. Three recovery variants verify ordinary lost acknowledgement, transient SDK lookup failure, and a wrong-World presence result followed by restored visibility. All replay bodies retain the identical idempotency key and start only one Run before the separate, newly bound explicit attempt. Frozen files, observations and the same stored Experiment checkpoint remain preserved. The production presence guard and Candidate/Experiment implementation are unchanged.

Five focused files / 72 assertions passed, zero failed/skipped. Architecture, full lint and TypeScript/production build exit 0 under a 768 MB budget; logs use the `workflow-reuse-integration-repair-` prefix in the D: evidence directory. This repair needs a new integrated exact SHA and independent complete CI. The failed 643c072 receipt must stay failed, and earlier 271a11e passing reports do not cover the new tests.

An attempted connected real-Mission UI inspection also failed before application navigation because Tabbit could not dispatch its initial CDP target creation. Diagnostics confirmed idle/no owned pages, task finish succeeded, and the matching owned preview was stopped. `main-flow-connected-ui-readonly-attempt.json` records this as UNVERIFIED tool transport, not an application failure. No browser login, user-file export or business write occurred. Fresh cloud-file execution approval and real Hidden/Gate F/accepted download/reopen remain pending.
