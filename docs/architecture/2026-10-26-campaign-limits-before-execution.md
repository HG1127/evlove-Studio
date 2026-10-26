# Check Campaign limits before execution and report actual progress

Owner: Evolution OS maintainers. Date: 2026-10-26. No architecture or acceptance-policy exception.

## Actual observation

The newly authorized single-round SOP confirmation ran implementation `80739a93a54c9eb5b0f36313406a62595a30892d`. Its frozen Candidate `9d8c04ec193fc2945f8526220dc298151e5358bde1f12b26196d6dc1c3eda35d` retained all 57 original preformatted/code nodes exactly and returned passing native interaction and desktop/mobile style checks. The visible assessment nevertheless rejected promotion: quality 92 versus 95.4, reported global delta -3.5, three additional Hard Gate failures, and partial protection coverage. No Hidden/final execution, accepted output, delivery or lesson followed. The maximum one repair was never reached; its counter remains 0/1.

After that completed first round, the next control iteration ran another Baseline, including an actual `evaluate` request at `2026-10-26T06:46:33.356Z`, before the preparation preflight enforced `maxRounds=1`. No second Candidate was generated. The Workflow completed and the guard observed that terminal state at `06:47:41.021Z`, before the conservative `06:57:41.332Z` deadline. The failure and the unnecessary evaluation are preserved, not retroactively removed.

The same execution exposed misleading progress: preparation returned destination `phase: experiment` with a completed `plan` checkpoint, and composition rendered “experiment 已完成”. The actual experiment was still idle at that point. A destination phase is not a completed test or acceptance verdict.

## Decision

Before starting Baseline or dispatching an existing execution checkpoint, the composition root reuses Core's existing resource/safety/completion policy, `campaignRepairLimitStopReason`. A reached limit bypasses those execution ports and reaches the existing preparation settlement. It does not reset time, patience, cost, rounds, evidence or the repair counter. Projected cost remains an estimate, not actual monetary billing.

Evidence incompleteness is kept separate from resource exhaustion: an eligible frozen Holdout recovery with available resources still reaches its existing governed port. Core/Harness remain independent of concrete infrastructure; no Domain rule is added to UI or adapters. Preparation event payloads retain the legacy phase and add `completedPhase`/`nextPhase`. Job progress uses the preparation reason rather than inventing completion of the destination phase. Historical events and the trial's stored bytes remain unchanged.

## Verification and limits

Before the fix, the regression fixtures reproduced nine failures and one passing under-limit execution. They exercise real policy decisions with mocked external ports, so a forbidden paid call fails immediately. After the fix, targeted tests cover round, patience, wall-time, accumulated/projected cost, all three execution checkpoints, under-limit Baseline execution, governed incomplete-evidence recovery and truthful preparation progress. Broader frozen-validation, experiment, acceptance, preparation and AI-wait regressions also pass.

The 9,665-byte metadata-only outcome is signed Artifact `sop-confirm2-outcome-7a6b95faa445a34db2c9ef11`, SHA-256 `7a6b95faa445a34db2c9ef11ad8ceecad3680efff90d5bdb3d08bf52af1a0ecf`. Exact readback and all 57 ledger entries verified at `2026-10-26T06:52:58.924Z`; registration did not change formal Mission state. Ten physical AI requests have matched usage receipts, reporting 232,480 total tokens. Actual monetary billing remains unavailable. This fix has no new paid trial and does not change the failed result or establish any of accepted delivery, real user benefit or causal lesson transfer.

Final engineering checks passed: 116 unique relevant tests across eight files, changed-file lint, `pnpm architecture:check`, and the unchanged `pnpm build` command with all four TypeScript project references. Node heap settings were bounded; compiler configurations were unchanged. The pre-existing `node:crypto` browser-externalization warning from the outcome adapter remains; these checks do not certify browser runtime or a new live acceptance result.
