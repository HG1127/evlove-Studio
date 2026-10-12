# Direct model exact-schema handoff

## Scope

Branch: `codex/ai-transport-recovery`.
Runtime: `58ab40d59c912c86e2300a588a08d862ee0826eb`.
Parent: `2d15928d85d44501789d4b704b7505844ec070eb`.
Checkout: `D:/Downloads/evolution-os-smoke-temp/server-main-flow-recovery-build-worktree`.
Integrate only this runtime and the following documentation commit onto independent candidate `68369c53f91425e99d00ad4baddd74036276f3c3`; earlier Root transport/reuse/fixture commits are already integrated.

## Reproduction and change

Direct environment-default and explicit JSON Schema profiles relied on wire-level structured-output options and omitted the literal task schema from their system instructions. A compatible-provider fixture that accepts but does not enforce the wire schema reproduced four failures: Responses and Chat explicit JSON Schema, environment Responses, and the environment Responses-to-Chat endpoint fallback. JSON Object and prompt JSON profiles already included that same schema.

All direct profiles now include the exact task schema in the system prompt. Existing native wire-format options, operation parsers, strict final-JSON parsing, Zod validation and caller payloads remain unchanged. Scoring-route fingerprints include `exact-schema-instructions-v1` only for the changed environment-default/JSON Schema profiles. Existing JSON Object/prompt JSON profiles keep their prior fingerprint because their prompt did not change. Changed scoring identities require fresh measurement rather than reuse of old scores. Gateway remains optional.

No Domain, Harness, Candidate, Experiment, Gate F, Runner, storage schema or production settings were changed.

## Local evidence

Evidence files are under `D:/Downloads/evolution-os-smoke-temp`:

- `server-ai-exact-schema-corrected-before-v2.json`: 10 cases, six passed/four genuine failures before repair. Earlier missing connection-ID/label fixture failures are retained separately and do not prove a runtime defect.
- `server-ai-exact-schema-final-related.json`: 11 unique files, 143 passed, zero failed/skipped, terminal exit 0. This includes the 15 new prompt/profile/fingerprint/strict-rejection cases and Baseline, Holdout, identity and AI transport regressions.
- `server-ai-exact-schema-final-gates.json`: architecture check, full lint and TypeScript/Nitro production build each exit 0. The first build's test-output-type failure is retained in `server-ai-exact-schema-gates-first.json` and `server-ai-exact-schema-first-build.log`; the fixture now uses the public input schema to apply defaults rather than casting away the error.
- `server-ai-exact-schema-development-handoff.json`: source hashes, exact commands and immutable report hashes.

Commands: installed Vitest CLI `run` with the 11 files listed in the handoff, `--maxWorkers=1 --reporter=json --outputFile=D:/Downloads/evolution-os-smoke-temp/server-ai-exact-schema-final-related.json`; `pnpm architecture:check`; `pnpm lint`; `pnpm build`. Checks used D: TEMP/TMP and Node heap 768 MiB/semi-space 4 MiB, serial heavy commands. Checks ran on the source contents subsequently committed as the runtime SHA above.

## Actual saved-provider preflight

The existing saved MiniMax connection was resolved through the current local operator/Vault path; no Key was requested, printed or changed. Connection revision 1 uses HTTPS `api.minimaxi.com`, Chat Completions, JSON Object.

A fixed synthetic Baseline-shaped payload contains locally measured `double(x)=x*2` outputs for 0, 2, -3. Three trusted local arithmetic assertions pass. It contains no Mission identity, original/Candidate bytes or user-file excerpts. Its canonical request SHA-256 is `9247981edb9d16959dd132d312b1c8e205d1721ffc522bd4233616b03cd24c87`.

The valid initial preflight returned provider HTTP 200 but the governed application returned 500/missing required evaluation fields. The subsequent preflight on runtime 58ab40d returned application HTTP 200 in 10,944 ms, passed the existing operation contract, and exactly matched one `V-SYNTHETIC` case and one `C-SYNTHETIC` criterion. Safe wire observation confirms all nine required evaluation fields, exact schema instructions and JSON Object wire format. Raw model text and credentials are not included in public receipts.

**Causality limit:** JSON Object already received the exact schema before this change; its prompt is unchanged. The two real-provider requests are therefore not an experiment proving that this patch caused the later success. The earlier valid response-shape failure remains unclassified. The first empty-input preflight is also not a valid measured Baseline and may hit the existing all-zero-output rejection. These failures remain preserved, not replaced by the successful probe.

Receipts: `main-flow-synthetic-baseline-model-structured-receipt.json` (initial valid failure), `main-flow-synthetic-baseline-model-after-structured-receipt.json` (successful request), `synthetic-baseline-model-after-wire-shape.json` (safe field/format metadata), and `synthetic-baseline-model-measurement.json` (trusted arithmetic). Owned preview PID 19232 was stopped, port 18015 has no owned listener, old World recovery was disabled, and no Mission/Job write occurred.

## Integration, production and actual acceptance

Independent candidate 68369c5 passed complete local CI: 332 unique files, 2714 passed/one explicit skip, architecture/full lint/build, Runner 23, compiled readonly UI and 419 unchanged build hashes. Receipt `ci-run-reuse-repair-68369c5/verification.json`, SHA-256 `cefbfb103f9acd369bf8be1a4a7ceb14f98b5290dc2cf91aee1a734b509a93dd`. It excludes this new increment. A new integrated exact SHA and complete CI are required; Root does not push main or deploy.

At 09:52 UTC, the public production build-info GET timed out (curl exit 28). Official authenticated Vercel CLI **GET project target metadata** succeeded and still identifies READY production deployment dpl_9t5CJQXuhD2ibdCGyZ1jwP6DA4Du at `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`. This is target metadata, not a fresh application build-endpoint verification, and proves neither 68369c5 nor 58ab40d is deployed. Receipt: `server-ai-schema-production-readonly-receipt.json`. Frozen PR #6 and the existing hosted billing/local-CI exception boundary remain separate.

Real Mission `project-1790480873333` was last read at revision 29. Candidate-001's physical frozen hash was previously checked as `9a616d1a919e18f6f6e606cee02ca9f9617e680c2875bf888fca07f8e863f068`; the original is `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`. Stored Baseline/status and synthetic model preflight do not prove a fresh Mission run. Fresh actual Baseline/diagnosis, changed Candidate evidence, paired same-Hidden evaluation, Gate F and identical accepted downloaded/reopened hashes remain unaccepted. The fresh real user-file cloud-export question is already pending; no new authorization is inferred from this synthetic test and no user file was sent to the model/Sandbox.