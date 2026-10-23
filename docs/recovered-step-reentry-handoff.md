# Recovering Step replay admission

## Observed production failure — 2026-10-23

Exact main/production `023c3a5dd83f15823b3c1573e7ccadbb4485d64f` had complete Quality Gate and Production Smoke evidence. The same approved Mission `project-main-flow-sop-fields-7ba9c02b-0ffc-48bc-b109-101592ae0d14` resumed once through the normal start endpoint as Run `wrun_01M5M1J6KDBQVXRQQBD1HT28SQ`, Job `workflow-control-6b47f26b-d317-44e8-9693-b562b36b03cc`. It persisted its recovering Campaign as running at revision37. Actual SDK status subsequently became failed; stored Job running1% is stale and is not live execution.

Official deployment logs retain an initial 300-second Step timeout and a subsequent FatalError from the recovery guard. Its idle-only predicate rejected the same owner after the earlier attempt had persisted running. The actual SDK Step metadata confirms two attempts and terminal failure at 09:40:33.929Z. The timeout log has no Run ID or trace; its attribution uses the same deployment, Step path and initial start time. The timeout cause remains unproved. Baseline `baseline-server-1792400369038` (75/Safety PASS/coverage90), five prior failed proposals, Original SHA `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a` and all four earlier controller Jobs remain unchanged. There is no frozen Candidate, fresh Experiment/Hidden pair, Gate F or accepted download/reopen.

Local private evidence stays under `D:/Downloads/evolution-os-smoke-temp/real-mission-023c3a5-20261023/`: `same-mission-recovery-terminal-failure.json`, `recovery-observed-03-summary.json` and `failed-run-runtime-errors-01.private.jsonl`. User content and credentials are excluded from source and CI.

## Narrow correction

The Workflow composition uses the existing public Harness `serverRecoveringControlRetrySource` to recognize the exact resumed owner in idle or running. It still requires complete recovery context, readiness and independent full SHA verification. The normal idle-only Harness predicate and strict independent collection owner/allocation checks remain unchanged. Owner operation/Run, generation, active Job, input and parent identity, human attention, stop/completion, round, budget and time limits remain mandatory. This change does not retry a terminal SDK Run or repair a stale Job.

Synthetic composition regressions preserve both original failures (39 passed/2 failed) and show the correction (41 passed/0 failed), including control-AI and experiment-build recovery after the persisted running write. Negative cases reject source, Public/Hidden paper, goal, parent, checkpoint, receipt/context, owner/Run/generation, pending attention and stop boundaries before collection or writes. These tests are controlled source regressions, not real Mission acceptance. Local related tests passed: 21 files/460 tests/0 failed/0 skipped, maxWorkers1. Architecture check, full lint and production build passed. Their commands/logs, source stability and retained failures are recorded under `D:/Downloads/evolution-os-smoke-temp/recovered-step-reentry-20261023/`. Exact-commit full CI remains required before integration.

## Remaining delivery and acceptance

Dedicated Git/CI chats own integration and full CI. A new publication needs specific approval and exact deployed-main verification. Only then may the existing normal explicit failed-control retry admit a new bound control for the same Mission; the consumed ordinary recovery key must not be replayed. No production Job repair, Cron, migration, secret change, threshold/budget/timeout relaxation or new Mission is included. Changed frozen Candidate, Experiment, fresh same-Hidden Current/Candidate evidence, Gate F and identical accepted download/reopen remain required.
