# Offline frozen Artifact readback recovery

## Integration scope

Branch: codex/offline-artifact-readback. Runtime source: f76c41c19587989d082416346deaa48e8b2ca5de.
Checkout: D:/Downloads/evolution-os-smoke-temp/server-main-flow-recovery-build-worktree.
Local parent: 6c46a7a01a622c60f70fe5494f3d19dcf9d27225; this is the earlier recovery stack already represented in the independently checked PR #6 candidate c24608a40e84eea051b696302d8be41904434ce4.

Apply the incremental commits 4d257e55a28bb4a0c650e24d2603d6c262f4fa1c and f76c41c19587989d082416346deaa48e8b2ca5de, then this documentation commit. The first is the root cherry-pick of agent source 39dfda9e64ea2eb5bdd2fa231955979b79179287; do not apply both equivalents. Do not reapply the older parent stack.

Git owns integration and PR/main synchronization; CI owns independent complete gates and deployment. Root has not pushed, merged, deployed, changed secrets, triggered Cron or sent user files to a cloud executor. PR #6 remains draft/open at c24608a, held pending the human answer to the existing local-CI exception request. This handoff does not authorize a merge, alter that approved candidate or replace an unavailable hosted gate.

## Main-flow defect and fix

A successful Experiment and full paired Hidden result can reach Gate F while the frozen Blob is temporarily unreadable. Its exact saved pause was admitted only after a forced AI health probe. When the provider was offline, an otherwise local byte/hash readback never ran. The initial actual workflow-entry reproducer expected run-campaign but received wait-human; the failed record is retained.

The public pure Harness helper canRecoverServerArtifactReadbackWithoutAi classifies only an exact bound artifact-acceptance-evidence-pending wait. It requires current-round validation, a unique ready winning Candidate, full authoritative same-paper Hidden evidence, its physical and evidence fingerprints, usable unchanged scoring context, recent valid physical observations, reusable Visible Baseline and already passing frozen-file metadata settlement. It performs no I/O and does not grant acceptance.

Backend and Workflow use that classification to omit only the unnecessary health probe. Restore still verifies the saved canonical SHA and a different active control Job. Execution retains Job ownership/readiness and physically reads original/current and frozen Candidate files. Gate F reads and hashes again before persisting the acceptance decision. Incomplete evidence, unknown/changed routes, expired observations, stale evidence hashes, manual/Safety/protected failures, approvals, exhausted budgets, Repair and other recovery markers retain the AI/capability boundary.

Independent review reproduced a second timing bug: physical storage I/O could carry a 9m59s observation over the ten-minute limit after the first eligibility check, allowing a new browser measurement before an offline Judge failed. The guard now runs after successful physical readback. One decision timestamp is used by eligibility, Hidden freshness and Baseline reuse before starting fresh measurements. The regression proves zero AI/browser/writes at that expired boundary. No history or failed evidence is silently cleared, and a ready Release is not approved.

## Local verification

All receipts below are under D:/Downloads/evolution-os-smoke-temp. Runtime/test raw hashes are recorded in offline-artifact-readback-source-hashes.json and stayed unchanged through the build and UI check.

| Check | Result | Evidence |
| --- | --- | --- |
| New pure helper | 78 passed | harness-artifact-readback-recovery-focused.log |
| New composed workflow cases | 17 passed, included below | tests/integration/server-offline-artifact-readback.test.ts |
| Relevant regression | 55 unique files, 824 passed, 0 failed, 0 skipped | offline-artifact-readback-final-related.json; offline-artifact-readback-related-files.json |
| Architecture | passed | offline-artifact-readback-architecture.log |
| Full lint | passed | offline-artifact-readback-lint.log |
| TypeScript and production build | passed | offline-artifact-readback-build.log |
| Runner first attempt | 10 passed, 1 failed | offline-artifact-readback-runner.log |
| Runner unchanged rerun | 11 passed, 0 failed/skipped | offline-artifact-readback-runner-recheck.log |
| Built readonly UI on source f76c41c | 5 routes, 390px, denied storage, zero errors/writes | offline-artifact-readback-built-ui.log; offline-artifact-readback-preview-receipt.json |
| Built-file integrity | all 419 hashes unchanged after UI | offline-artifact-readback-build-files.json |
| Public production readonly UI | same 5 routes and checks passed; still e3482e75 | offline-artifact-readback-production-ui-receipt.json |

Validation commands were pnpm architecture:check, pnpm lint, pnpm build, pnpm runner:test, and pnpm exec vitest run with the exact 55-file manifest, --maxWorkers=1 and JSON output. Readonly UI used node scripts/production-ui-smoke.mjs against the isolated compiled 8107 preview and then the public production alias. TEMP/TMP and logs were directed to D:. The owned preview was stopped; the existing 8000 service was preserved.

The first Runner failure was its good source-grounded search fixture reporting failed rather than verified. An unchanged isolated diagnostic passed; the unchanged full rerun then passed all 11. The cause remains an unclassified intermittent failure, not an established environment fault or a code fix. Independent integration CI must recheck Runner and retain the first failure.

Other failed development records are retained: offline-artifact-readback-before.log (forced-health blocker), offline-artifact-readback-io-age-before.log (one unexpected browser execution after readback crossed observation expiry), and intermediate expectation/public-import failures. These failures were corrected before the final 824-test result.

All workflow regressions use synthetic Missions and injected storage/model/browser ports. Physical fixture bytes, hashes, actual planner/execution functions and refusal branches are exercised. They do not prove a real model provider, durable production Workflow, Supabase writes or the imported user's Mission. The related run is not a replacement for complete integrated CI.

## Current production and CI boundary

Public build-info before/after the readonly UI at 2026-10-10 01:11 UTC returned e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9, main/production. This proves only that deployed source; f76c41c and its parent recovery stack are not production verified.

The independently checked frozen c24608a candidate passed 321 files / 2527 tests, with zero failures and one explicit live-Sandbox skip, plus architecture, lint, build, Runner11 and readonly compiled UI. Its verification.json is in ci-main-flow-recovery-c24608a. It does not cover these new commits. Hosted Quality Gate 37929090823 at c24608a executed zero steps and failed on GitHub account payment/spending limits. No hosted retry or account change was performed. PR #6 and main remain held at their recorded identities pending the existing human exception answer.

## Real Mission acceptance remains pending

The latest available authenticated record is historical: project-1790480873333, revision 11, paused Plan, zero Candidates. Its six stored Baseline runs are not new live execution. This increment did not freshly inspect its exact pause or export its files.

Original recorded Artifact: artifact-2ac80e2f-b1f2-4cb9-a3bf-8587577f767f, 264173 bytes, SHA-256 6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a.

The missing acceptance receipts are fresh real Baseline/diagnosis, an actually changed frozen Candidate ID and SHA-256, current/Candidate same-Hidden paired execution, Gate F and downloaded/reopened identical accepted SHA-256. Manual usable custom model/key, operator/Vault, authorized original/Candidate export and hosted account billing are deferred. Direct user-defined models remain the connection design; Vercel AI Gateway is not a required condition.

