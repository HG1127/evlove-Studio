# Direct AI scoring fixture repair — 2026-10-10

## Scope

Test-only commit `01f16b50ff43aa174545682138feef6fb2b56db8` on `codex/ai-transport-recovery` updates `apps/backend/src/services/ai-responses-output.test.ts`. Its explicit Responses and Chat expected fingerprints now include `DIRECT_AI_SCHEMA_RECOVERY_VERSION`. Both reject the preceding scoring identity. Responses still rejects the older pre-parser identity, and its API-key rotation assertion remains intact.

The existing runtime recovery policy and all application source are unchanged. Old scoring evidence must remain stale when the measurement policy changes; no fingerprint or safety check was weakened to satisfy the test.

## Observed failure and repair

Independent integrated candidate `077ec7b171fa99297eef9103a7405f3a05107468` finished with **FAILED**: 334 unique files, 2,745 passed, two failed, one skipped. Both failures were these stale fixture expectations. Architecture, full lint, production build, Runner 23/23 and readonly browser checks passed; all 419 build hashes remained unchanged. Root independently checked all 34 raw batches, the exact clean checkout, manifest and build hashes. The immutable receipt SHA-256 is `f41adbeba3038833c280787ca9e84b22e287a4a2714a69444433a463e782c102`.

Root reproduced the failure on unchanged code: nine tests passed and two failed. After the fixture repair, five relevant files passed **61/61**, with no skips. Relevant files cover the external Responses output boundary, gateway scoring identities, literal schema instructions, bounded structural correction and shared evaluation identity.

Local checks on this source all exited zero:

- `node node_modules/vitest/vitest.mjs run apps/backend/src/services/ai-responses-output.test.ts apps/backend/src/services/ai-gateway.test.ts apps/backend/src/services/server-ai-schema-prompt.test.ts apps/backend/src/services/server-ai-schema-recovery.test.ts packages/contracts/src/ai-evaluation-identity.test.ts --maxWorkers=1 --reporter=json --outputFile=D:/Downloads/evolution-os-smoke-temp/schema-feedback-fingerprint-fixture-after.json`
- `pnpm architecture:check`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

The gate log finishes at 2026-10-10 11:06:12 UTC. Checks use D: temporary storage and bounded Node memory. No Runner implementation changed. A new exact integrated candidate needs independent complete CI; the failed 077 receipt remains preserved and cannot become PASS by editing its results.

## Evidence and integration

Evidence directory: `D:/Downloads/evolution-os-smoke-temp`.

- `schema-feedback-fingerprint-fixture-before.json` and `.log`: actual unchanged reproduction.
- `schema-feedback-fingerprint-fixture-after.json` and `.log`: 61 passing tests.
- `schema-feedback-fingerprint-fixture-gates.json`, `-architecture.log`, `-lint.log`, `-build.log`: exit-zero checks.
- `server-ai-schema-ci077-final-root-audit.json`: independent terminal failure audit.
- `ci-schema-recovery-077ec7b/verification.json`: original complete failed candidate.
- `server-ai-schema-fingerprint-fixture-development-handoff.json`: committed source hashes and evidence for dedicated integration chats.

Cherry-pick only this test repair and its documentation commit onto 077. The preceding runtime/documentation commits `dea6d74` and `18fb681` are already present there. Root does not push main, deploy or change production configuration.

## Remaining acceptance boundary

The prior live synthetic Candidate succeeded on its first already-valid response; it did not exercise live structural correction. This test-only increment does not establish new provider behavior or a real Mission acceptance. Real user-file model/runner export approval, fresh Baseline, changed/frozen Candidate execution, paired same-Hidden validation, Gate F and exact accepted download/reopen remain pending. No real user bytes were exported, and no business state, secrets, migrations or production Cron were changed.
