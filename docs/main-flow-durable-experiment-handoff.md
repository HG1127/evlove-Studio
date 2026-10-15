# Durable server Experiment operation handoff

## Actual production failure

Production `978b100b66a0b4c75cc56f45a0f0dadff12bbea1` was deployed after the human's exact-version approval. Real Mission `project-main-flow-sop-b2663c8f-f695-436a-a219-691ff27fe273`, Run `wrun_01M4YYJV0A389PD989AFKQA7DS`, completed fresh Baseline `baseline-server-1792040225529` and diagnosis, then stopped before any Candidate snapshot was persisted. The original is 264173 bytes, SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`. Baseline Safety PASS does not mean acceptance: rubric 69, whole protection partial/unverified, unchanged 92-point target.

Official Workflow metadata binds failed step `step_01M4YYJVQMCKDHH8A2BSQF4N3Y` to that Run, attempt 5, first start 05:05:14.257Z and terminal time 05:41:42.982Z on 2026-10-15. The same deployment's step request began 60 ms earlier and logged HTTP504 / timed out after 300 seconds. At 05:43:15.946Z the SDK was **failed**; its Job remained stale running/60%. This is no verified live wait. No Job repair, cancellation, duplicate Run, migration, production secret change or blob deletion was performed.

Evidence directory: `D:/Downloads/evolution-os-smoke-temp/durable-experiment-slices-20261015`. Failure receipt: `real-experiment-step-failure-receipt.json`, SHA-256 `c3964df5d32f7bb3ed5e1e0ad0bad1f0e738e60a29829cbe58b671882d24fdff`. Raw Workflow metadata and runtime logs remain private; the receipt contains their hashes. Terminal Mission/SDK receipt is `../server-ai-selection-20261014/sop-new-mission-authorized-20261015/normal-flow-monitor-native-978b100-0548-safe.json`, SHA-256 `289dd7927a003c09cc03cc68fa1860437ab672f16592d7f0bf55191b6ab683c5`.

## Scope and invariants

Branch `codex/durable-experiment-slices` is isolated and based on exact production 978b100. Scheduling is the scope: the Candidate builder, mutation rules, independent Judge policy, winner rules, Hidden, Gate F and delivery implementation are unchanged. The separate held PR22 / central31 protection patch remains unapplied.

The previous server Experiment built all selected Candidates, then executed and judged them inside one SDK step. Artifact-target Workflow composition now returns to the SDK after one build, execution or independent assessment. Running output persists actual snapshots, failures, raw answer sheets and completed judgments; its Plan checkpoint stays Plan. It cannot claim a Winner or ActionCompleted for a partial experiment. All selected identities remain selected; final ranking still uses every successfully built Candidate and the same Baseline. The synchronous compatibility API and non-Artifact path remain available.

A versioned **private SDK continuation** binds the complete schema-normalized Mission generation, selected order, route, runtime and settlement policy. It is never recovered from public input, Mission fields or events. The existing control-owner/CAS guards still apply. Every resume rechecks exact frozen metadata/physical bytes and checks generation again after awaited verification. A changed generation, missing private context or unavailable frozen bytes fails closed; it never regenerates replacement files. The generic Mission mutation policy is not expanded.

Fresh same-Run raw sheets retain genuine UNVERIFIED results; this grants no verified authority. Expired observations are actually executed again without changing the Candidate. The existing failed-Judge reuse path still requires its complete physical/input/evidence binding, valid verification statuses and unchanged 10-minute TTL. Independent judgments remain independent; route/runtime changes invalidate continuation.

The original 32 control-phase guard remains. Experiment operations have a separate bounded loop of 24 (eight configured Candidates times build/execute/judge), with unique monotonically increasing SDK iteration IDs. A non-progressing phase stops at that bound. Scheduled cycles retain their own counter and clear private carriers.

## Validation and remaining delivery

Run relevant regressions with `--maxWorkers=1`, `pnpm architecture:check`, `pnpm lint` and `pnpm build`. Final exact-source command/exit/log/build manifests and commit SHA are saved in this evidence directory and the shared Root handoff after checks finish. First integration/fixture type failures and all subsequent reruns remain recorded. Synthetic tests verify scheduling and refusal behavior; they do not prove the real Mission chain.

A single build, executor or Judge can still exceed a platform deadline. This change removes aggregation across Candidates and phases; production recovery still requires a fresh real Run to prove sufficient phase duration. If a Mission CAS save succeeds but the SDK loses the step result, a mismatched generation is preserved and refused rather than claimed exactly-once. The failed production Run is not repaired or automatically restarted.

Dedicated Git/CI owners must run the full exact-commit Quality Gate and prepare delivery. The human's production approval covers 978b100 only; any new production revision needs specific approval after its exact candidate and evidence are reviewable. Preserve the original and the approved three-field SOP contract. Then use the normal supported start/retry path and verify actual Candidate freeze, Experiment, same-Hidden current/Candidate pair, Gate F and identical accepted download/reopen. This branch does not prove those remaining stages.
