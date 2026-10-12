# Accepted text format: independent full-suite regressions

## Source and failed integration

Base development SHA: `13c69808d744167d0d8548f7dcac94d71fd4261e`. Branch: `codex/acceptance-format-regressions`.

Independent CI candidate `40c3ab48d12bd4313cbf0965355c2fcb8daef366` finished all 317 test files with 2410 passed, 17 failed and one explicitly skipped live Sandbox case. Its other local architecture/lint/build/Runner/compiled UI gates passed. The overall candidate is FAILED; retain that archive unchanged at `D:\Downloads\evolution-os-smoke-temp\ci-text-boundaries-40c3ab4\verification.json`.

The 17 failures used accepted Snapshot/frozen receipt file formats inconsistent with the original Source. The shared Demo Target is `research-agent-system-prompt.md`, extension `md`, MIME `text/markdown`; older accepted fixtures said TXT or HTML. The Git duplicate-path fixture additionally changed only a Markdown Snapshot to a TypeScript name while retaining the old receipt. The original-format identity guard correctly rejected those fixtures before their intended completion, release, duplicate-path or package assertions.

## Correction

Only six test files are changed. Valid acceptance fixtures now keep the original Markdown format in Snapshot, frozen receipt and primary output. Their original content, identity checks, release/learning requirements, mixed-package rejection and acceptance invalidation assertions remain. Git duplicate-path cases now start with two valid TypeScript inputs and consistent frozen identities; both ordinary and case-insensitive collisions are rejected before executor invocation.

Five additional cases explicitly reject jointly wrong text formats despite updated matching receipts and evidence binding: Git publication, campaign completion, candidate package/delivery (TXT and HTML), and human acceptance without storage mutation. No production guard, format policy or Gate F implementation is weakened.

The parallel package/human-review contribution is `453a8fcf21b697677d6eba06997383793fd9a329`; its two test-file contents were integrated without reapplying the previous BOM/format chain.

## Local evidence and limitations

Evidence directory: `D:\Downloads\evolution-os-smoke-temp`.

- `format-control-regressions-before.json`: unchanged development runtime reproduced seven control/search failures (44 passed / 7 failed).
- `format-all-failures-after.json`: all six affected files passed 101 cases, zero failures.
- Final broader regression passed 34 files / 427 tests. Architecture, full lint, TypeScript/production build and all 11 Runner cases passed. Compiled readonly UI passed five routes, 390px mobile and denied-storage recovery without page errors or writes. Results are recorded in `format-fixtures-development-handoff.json` and associated logs. Exact source hashes are recorded separately.
- `format-fixtures-current-production.json` identifies production main `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`; this read does not prove the new development source.

Git and CI must integrate this new independent correction, identify the exact new candidate SHA, and rerun the full suite. A passing affected subset cannot replace their full gate. Hosted CI remains subject to the recorded account billing/allowance block; no repetitive retry or deployment is authorized by this evidence.

The real Mission `project-1790480873333` still lacks observed fresh Candidate, paired same-Hidden validation, Gate F and an identical accepted downloaded/reopened file. This fixture correction is not a real Mission acceptance receipt. A separate branch is implementing explicitly bound recovery from machine capability pauses and a safe fresh-measurement entry for legacy zero-Candidate Plan pauses. Its source and validation must be handed off independently. No production business Workflow, Cron, cleanup, migration, secret/configuration change or user-file export was executed here.