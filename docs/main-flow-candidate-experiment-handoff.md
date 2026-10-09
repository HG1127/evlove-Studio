# Candidate / Experiment Judge recovery handoff

Date: 2026-10-09 (Asia/Shanghai)
Branch: codex/main-flow-candidate-experiment
Base: 3e7804e362c909b2ae747e4d43ac4c2d7da02242

## Change

The local independent evaluator previously resent first-pass excerpts when a Judge omitted required rubric rows. A complete verified observation could remain unavailable to focused recovery. Recovery now rereads original observed output with a shared 36,000-character request budget allocated across mapped runs. Small observations stay complete; larger observations retain truncation metadata and criterion-focused retrieval. Supplements bypass the result cache and require a real provider. A failed supplement preserves UNVERIFIED without fabricating a product failure. Existing Zod response validation, criterion settlement, Candidate hashes and execution records remain unchanged.

Scope: evaluation/service.ts and retry-live.test.ts. No changes to AI settings, Core acceptance/criterion settlement, Harness review version, UI panels or validation retry options. Integrating the other worktree's service.ts proposal should retain the aggregate budget rather than allowing 36,000 characters per mapped run. The pending Core document-workflow evidence policy and forceJudgeRefresh wiring remain separate work.

## Verification

The new regression first failed because recovery received five excerpts instead of the complete synthetic observation. Final focused evaluation: three files, 16 passing tests. They cover settlement from complete observations, many-case aggregate bounds, partial execution refusing supplementation and unavailable provider retaining UNVERIFIED. Architecture and changed-file lint pass. Final TypeScript and production build pass in the independent-dependency verification worktree. Source SHA-256 checks prove both changed files identical to this branch. These are injected evaluator tests, not live Mission acceptance.

Logs: D:/Downloads/evolution-os-smoke-temp/candidate-experiment-{focused,architecture,lint,build,build-symlinks,build-same-drive,install}.log. The first three build attempts failed because shared cross-worktree dependency paths broke Workflow generated imports (the preserve-symlinks trial failed Vite config loading). The final verification worktree installed independent dependencies offline; candidate-experiment-build-isolated.log records the successful TypeScript/client/Nitro build.

Managed development worktree: C:/Users/Administrator/.codex/worktrees/main-flow-candidate-experiment/evlove-studio-v3.0-6f145fe0-source. New isolated build verification: D:/Downloads/evolution-os-smoke-temp/candidate-experiment-build. The existing verify-clean-head worktree is untouched. No settings, credentials or user source files were copied.

## Remaining boundaries

No production request or mutation was performed. Production status from the brief is historical evidence, not a fresh read by this branch. A real changed frozen Candidate, paired Hidden, Gate F and reopened accepted bytes remain unproven. Usable authorized model, original-browser access and recorded cloud-export approval remain operator boundaries. Git synchronization and hosted full CI belong to the designated integration chat; this branch does not merge or push main.
