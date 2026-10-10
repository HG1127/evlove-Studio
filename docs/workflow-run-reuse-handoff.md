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
