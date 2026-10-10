# Main-flow browser assertions and accepted delivery

## Integration identity

Branch: codex/runner-assertion-readiness.
Runtime/test commit: 5e2cbb766d3262d8425a9916f4d1a65f4b429f97.
Parent: dedcdcfb28a0ef49bc81fa23baf831c886dd7236.
Checkout: D:/Downloads/evolution-os-smoke-temp/server-main-flow-recovery-build-worktree.

Apply this incremental runtime commit and its following documentation commit to the integration candidate containing the earlier recovery/offline-readback stack. Do not reapply the parent stack. Git owns integration and PR/main synchronization; CI owns independent complete checks and deployment. Root committed locally only.

Frozen PR #6 remains draft/open at c24608a40e84eea051b696302d8be41904434ce4. Its hosted Quality Gate runs 37929090823 and 37929096722 remain failed; the earlier zero-step account billing/allowance diagnosis and existing human exception question remain recorded. Its successful Vercel preview is not a deployment of this increment. Do not change that frozen approval candidate without resolving its existing boundary.

The newer integration 955408cd2a984211e7b513adb50ed25676614362 has 323-file unit receipts: 2622 passed, one explicit skip. CI was interrupted after architecture and unit recovery; its lint/build/Runner gates are not complete. Those receipts exclude this increment. At the latest coordination snapshot Git was idle and CI notLoaded/interrupted; neither was still running.

## Reproduced main-flow defects

1. Immediate browser observations failed a valid file whose input/click handler updated text, count or visibility after 180 ms. Actual generated SDK script and local Runner failures were preserved before changing code.
2. Generated HTML search checks filled a matching query while the matching slide was already visible. A delayed implementation hiding every nonempty query could pass that positive check. Clearing a query had the same initial-state weakness when the positive query matched all slides.
3. Persisted completed Hidden/passed Gate F records on that old paper could still be reused by direct Gate F, accepted package, ZIP, release approval, single-file download and an existing release grant.
4. The accepted Candidate panel required a historical Champion before displaying its current files and download controls.
5. The SDK command gave a single case 30 seconds despite individually valid navigation and asynchronous transitions taking over 32 seconds.

## Changes and boundaries

Local and SDK trusted scripts use Playwright retrying observations with their existing per-action limits: 5 seconds locally, 7 seconds in SDK. Input/click actions run once. Text uses escaped literal substring matching with innerText; regular-expression metacharacters, repeated whitespace and case retain their prior meaning. Failure summaries expose selectors rather than expected/observed file text.

The generated paper now has 15 steps: initial visibility, unmatched query/empty results, matching query/visible result, unmatched query again, then clear/all results. Both positive and clear must transition from an established hidden state. Only the exact tagged previous 12-step recipe for the same source is refreshed during suite normalization. Edited/custom steps and already updated papers remain intact. Assertions change Visible/Hidden fingerprints; old receipts are not rebound. The narrow interaction marker still produces partial protected-content coverage during scoring, not a claim that all content/protection requirements were verified.

A shared pure Core blocker denies old generated papers at Baseline reuse/entry, frozen Holdout preflight, direct Gate F settlement, delivery readiness, accepted file/package materialization and ZIP identity. Holdout preserves the Experiment checkpoint and original papers while persisting a recoverable pause before I/O. Current-file UI consumes that Core decision before any physical read. Explicit archived files retain their original frozen-byte readback as historical files, separate from current acceptance.

Non-rollback API, shared provider and durable release entries reject the old contract even when an existing grant is valid. Rollback remains available. Git publication already traverses the protected materializer. Accepted current Candidate files/download controls now render without requiring a Champion; all downloads still use the frozen bytes.

The SDK trusted cache name/version changed to evolution-browser-pw163-v2 / pw-1.63.0-v2 so an older script is not reused. No old cache was deleted. Its command budget now includes navigation, all existing step limits and rendering overhead within the existing 180-second batch ceiling; a 15-step case receives 150 seconds. Large batches can still reach that ceiling and must remain unverified on timeout.

## Final local evidence

All paths below are under D:/Downloads/evolution-os-smoke-temp.

| Check | Evidence/result |
| --- | --- |
| Relevant regressions | 36 unique files, 438 passed, 0 failed/skipped; runner-assertion-final-files.json and runner-assertion-final-summary.json |
| Actual trusted SDK script | final batch 9 recheck; actual Chromium and synthetic owned HTTP fixtures, including delayed positive/count/visibility, wrong observations, literal text and broken search/clear |
| Slow SDK search | runner-sandbox-assertion-final-related/generated-browser-results.json; verified, 34210 ms, 15 passing steps / 11 observations |
| Local Runner/build/release tests | runner-assertion-complete-runner-test.log; 23 passed, no failures/skips |
| Architecture / full lint / TypeScript + production build | runner-assertion-complete-gates.json and corresponding logs; all four gate commands exit 0 |
| Source identity | runner-assertion-source-hashes.json; 26 raw and normalized SHA-256 entries unchanged through compiled UI |
| Compiled readonly UI | runner-assertion-preview-receipt.json; five routes, 390px, denied storage, zero page errors/writes; owned 8107 preview stopped |
| Compiled files | runner-assertion-build-files.json; all 419 generated hashes unchanged after UI |
| Public production readonly | runner-assertion-production-ui-receipt.json; same five routes/mobile/denied storage passed; before/after deployed e3482e75 |

Regression reports are checked against the exact file manifest, not only a shell exit value. Original batch 6 had a PowerShell launcher error and no report despite a stale exit value; batch 9 lost its tool handle and had no remaining live process/report. Both were rerun using the installed Vitest CLI, with actual reports and exit 0. The final summary uses those replacements.

Initial builds exposed three test-fixture type errors: an incomplete Criterion score, an overly broad URL Mock type, and missing Release Target healthPath/extra Gate labels. They were fixed to the real schemas. Latest component and release reports override their earlier entries without double-counting the 438 unique tests. Failed reports/build logs remain retained alongside the final green gates. Tests are synthetic; H3/HTTP Blob/ZIP paths and actual browser execution are exercised, but no live model, cloud Sandbox, Supabase write or user Mission was accepted.

Commands: pnpm architecture:check, pnpm lint, pnpm build, pnpm runner:test; pnpm exec vitest run on the explicit file batches with maxWorkers=1, plus installed node_modules/vitest/vitest.mjs for replacements. TEMP/TMP were on D:. Readonly UI used scripts/production-ui-smoke.mjs against credential-free compiled 8107 and the public main alias, blocking all non-GET/HEAD requests. Existing 8000 was preserved.

## Production and remaining acceptance

Public before/after build-info at 2026-10-10 03:33:00–03:33:12 UTC identifies main/production e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9. This proves that deployed source only; 5e2cbb7 is not production verified. New integration full CI and exact-SHA deployment verification remain required.

The real Mission still lacks fresh Baseline/diagnosis, changed frozen Candidate ID/SHA-256, same-Hidden current/Candidate paired execution, Gate F, and downloaded/reopened identical accepted SHA-256. Its historical project-1790480873333 revision-11 Plan pause and original Artifact/hash are not fresh observations. No files were exported to cloud execution and no Job repair, production Cron, migration, blob deletion, secret change, main push or deployment occurred.

Usable user-defined model/key, operator/Vault access, authorized cloud export and hosted account billing remain deferred human boundaries. Vercel AI Gateway remains optional. Next work is independent integration of this increment, then fresh inspection/execution of the next authorized real Mission step; route checks and synthetic totals do not satisfy that acceptance.
