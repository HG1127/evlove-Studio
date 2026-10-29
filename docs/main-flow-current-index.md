# Current real Mission acceptance index

Observed 2026-10-29. Engineering CI and real technical artifact acceptance are separate. C40 has a changed frozen Candidate but no accepted/delivered file. No historical trial is reopened or regraded by this index.

| Item | Latest verified evidence |
| --- | --- |
| Latest terminal stored Mission | `real-evolution-sop-confirm40-f169c790-e198-44c7-88cc-2601b2d0208c` |
| Run / Job | `wrun_01M62RMWD9BAZFVXZPQBXWQM9B` / `workflow-control-496c1f45-8598-4ee0-8f52-ca841362601b` |
| Preregistered source | `ded72bde455fdf737babfa5acd6af9b3146950ac` |
| Observed lifecycle | Guard recorded Workflow completed / Job waiting at 03:04:02 UTC; campaign paused after its one round. Owner chat later reported an outer-model capacity error. A server process alone is not a live validation |
| Candidate | `CAND-01`, frozen 329,846 bytes, SHA-256 `5907e403a93e3b6b66ee8913198242c0570904b65fe16d86ceea82f36054aae4` |
| Original | 264,173 bytes, SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a` |
| Completed stages evidenced in storage | Baseline, diagnosis, planning, changed frozen Candidate and completed Visible experiment. The Candidate's intermediate `passed` state is not acceptance |
| Immediate primary blocker | The `PROTECT-ALL` external-runner case is UNVERIFIED because Vercel Sandbox returned HTTP 402: Hobby usage limit exceeded |
| Recorded quota reset | `2026-11-01T00:00:00.000Z` / 2026-11-01 08:00 Asia/Shanghai; this is the execution error's stated reset, not a new quota probe |
| Remaining acceptance | Ordinary Hidden idle, Gate F idle, zero output files; independent-final success, accepted download SHA and exact-byte reopen are not established |
| Other held evidence | Safety FAIL, uncertain/partial criterion scores and no Winner remain unchanged. The paired receipt is schema-valid, but lacks the unexecuted protection criterion |
| Fixed scope | Original 8 criteria / 6 Visible / 9 ordinary Hidden; all goals, minimums and protections unchanged |
| Next action / real-validation owner | `01a162a1-aafe-78b2-89a1-1d2acbc5c644`: read-only C40 evidence closure, then any fresh confirmation requires verified capacity, measurement prerequisites and applicable existing authorization. Do not restart C40, force an AI score for the missing runner case or buy/upgrade automatically |
| Engineering branch | `codex/current-source-quality-gate-fixes`, based on current `ded72bd`, contains the five fixture fixes plus the remaining fourteen known CI fixes |
| Full CI owner | `01a11ea4-143b-7101-bd72-e6ec520ddc2e`; new exact-source full gate still required. Git/main/deployment remain separate |

## Evidence and interpretation

`D:/Downloads/evolution-os-smoke-temp/final-security-tail-20261029/c40-existing-evidence-review.json`, SHA-256 `afcac138944dd322916c58e724badab1bd9404c0e363c68f5b74576793a0c9d3`, validates the Mission envelope and payload with public Zod contracts. It binds checkpoint revision 7, Candidate/frozen hashes, both saved paired observations and the current code's held Winner decision. This is a read-only review of stored evidence, not a new physical Blob readback, judge call, database query or final acceptance. Final questions were not inspected.

`c40-external-quota-blocker.json`, SHA-256 `b0517106940ce6ada37430ded57aeed699cc3a664782ddc74a809aa997c90bf8`, binds the actual 402 diagnostic to the protection case. Its artifact-packaging trace does not prove browser execution. The caller excludes that unverified case from evaluable Judge scope; Core correctly requires its proof. Neither gate is weakened. The previous incomplete PowerShell envelope projection is explicitly invalidated and preserved as `c40-existing-state-observation.INVALID.json`; it cannot establish Candidate/output counts.

The saved paired model scores also remain held: closure is 90/95 against 92, cross-consistency is 68/90 against 92, and Candidate Safety is FAIL/REVIEW. These observations are retained with their evidence limits. Fixing Sandbox capacity does not retroactively pass them. Historical C38/C39 planning failures and C37's partial frozen Candidate remain separately preserved; they cannot substitute for C40 Hidden/final/Gate F or a downloaded acceptance file. Complete C40 call-ledger/outcome and physical-delivery evidence still require closure.

## Completed engineering gate repairs

[Official first run 40800931308](https://github.com/HG1127/evlove-Studio/actions/runs/40800931308) tested `8e5598d`: 3,744 passed, 19 failed, 2 skipped across 434 files. Later build/Runner/E2E/UI steps were not executed. That failure is retained; local focused results do not replace it.

The current branch is based on `ded72bd`, retaining the separately implemented safe syntax-feedback and same-request malformed-Plan-draft corrections. It carries all known first-run fixes:

- Three old Harness fixtures now have a Zod-validated idle BaselineRun. Their unchanged assertions reproduced 5 failures / 15 passes before the fix and all 20 original tests pass afterward. No runtime guard or original-file reference is fabricated.
- Thirteen security failures exposed a real repository-rule violation: adding the cancellation-fenced RPC left a non-security migration last. The CLI-created `supabase/migrations/20261029025416_control_mission_fence_security_invariants.sql` restores the mandatory final snapshot, preserves all 22 older migration files and copied function bodies, and reasserts the new RPC's service-only permission. It also removes the migration role's global PUBLIC default function execution. Existing security tests stay; one additional test covers this default and the new RPC. Selecting an older migration in the tests is not used as a workaround.
- The HTML test now checks the current raw-span and structural-insertion instruction instead of an obsolete phrase. Its actual insertion, frozen-byte, privacy and rejection assertions remain.

The migration is **local code only, unapplied**. No SQL query, advisor run or migration rehearsal was executed. Effective database privileges and authorized rollout remain unverified. See `docs/architecture/2026-10-29-restore-control-cancellation-security-tail.md` and the migration README for the delivery boundary.

## Verification and handoff

Evidence directory: `D:/Downloads/evolution-os-smoke-temp/final-security-tail-20261029/`.

| Check | Result | Log |
| --- | --- | --- |
| Remaining two failed suites before this change | 14 failed / 6 passed | `before-fix.log` |
| Five affected files on current `ded72bd` base, `--maxWorkers=1` | 41 passed | `current-source-focused.log` |
| `pnpm architecture:check` | exit 0 | `current-source-architecture.log` |
| `pnpm lint` | exit 0 | `current-source-lint.log` |
| `pnpm build`, isolated retry with `NODE_OPTIONS=--max-old-space-size=1536` | exit 0 | `current-source-build-retry.log` |
| Old migrations / copied snapshot | 22 older files unchanged, copied function bodies unchanged | `static-migration-continuity.json` |
| `git diff --check` | passed before commit | completed handoff |

The first current-base build exited 134 under local memory pressure. Its log, the auxiliary metadata-reader failure and the check-wrapper serialization error remain recorded; none counts as pass. Only the build was retried after process/resource checks. `current-source-check-results.json` records both attempts. No new full CI, model call, isolated Mission execution, production write, plan upgrade, Job repair or migration execution was performed by this task.

All known 19 first-run failures now have passing focused coverage on the current source base. This is **not a full Quality Gate pass**. The dedicated Git/CI chats must establish one safe exact-source CI reference and run the complete gate before any main integration or deployment. The repository currently disables Vercel Git deployments for `codex/custom-backend-models` specifically; publishing a new branch must not implicitly authorize a preview or production deployment. No ignored private SOP/capture files belong in Git.

## Stop conditions

Keep all original goals, 8/6/9 cases and thresholds. A missing runner capability remains UNVERIFIED; valid negative/Safety/conflicting model results remain observations. No best-of retry, averaged pass, hidden/final question tuning, hand-built substitute or post-acceptance file regeneration is allowed. Only exact accepted bytes may be delivered.

No additional full Mission run is authorised by the timer, this code fix, a status field or an unused repair. Existing applicable authorization must also satisfy capacity and measurement prerequisites for a new fixed configuration: 30 minutes, one initial Candidate and one shared repair. Never reopen terminal C38/C39/C40 to spend an expired window. Business benefit and causal transfer require later independent evidence; technical acceptance does not imply them. Production Job/Artifact/Cron/key changes, migrations, user-file cloud export, purchases and deployment retain their existing explicit approval boundaries.
