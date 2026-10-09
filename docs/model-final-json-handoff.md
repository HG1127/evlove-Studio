# Final model JSON and exact Candidate content

## Observed failures and implementation

The backend parsed complete model content with JSON.parse directly, rejecting otherwise valid final JSON inside outer reasoning/fences. Browser extraction could instead choose triple backticks inside a JSON-encoded Artifact. Legacy closing-quote/bracket repair could also invent a parseable final result from truncated text. These are Candidate construction boundaries, not presentation details.

`@evolution/adapters` now owns `readStructuredAiFinalText` and `parseStructuredAiOutput`. They remove only closed leading think blocks and an entire outer JSON fence. Literal think tags, backticks, punctuation, Unicode and whitespace inside Artifact JSON strings are untouched. Incomplete reasoning, reasoning-only output, malformed/ambiguous final JSON and task-schema mismatch remain failures with safe diagnostic codes. Backend Chat and Responses both use the helper followed by their task Zod contract. HTTP/envelope/nonfinal/refusal rejection from the prior patches remains ahead of final-text parsing.

The browser compatibility shim applies the same outer normalization before its existing prose/JSON extraction and bounded schema retry. It retains separator repair outside quoted strings, but no longer appends quotes or brackets to incomplete model output. A genuine new complete reply may succeed on schema retry; locally synthesized completion may not produce a Candidate. Invalid-JSON diagnostics do not include raw private model text in errors or correction prompts.

Browser routed scoring identities include `final-json-v1` and result cache v2.10 ignores both older v2.8/v2.9 entries. Old locally repaired results must not bypass the new boundary. Backend previously accepted only strict parseable JSON, so prior valid backend score identity is retained. No stored Mission/history/Artifact or production blob is deleted.

## Development and local evidence

Branch `codex/model-final-json`, based on `758290742a3ebf6c4b25425c72671245d00806b3`. Managed source: `C:/Users/Administrator/.codex/worktrees/model-final-json/evlove-studio-v3.0-6f145fe0-source`.

The owned D-drive checkout was hash-verified against the preceding branch and advanced to its exact committed source before receiving this patch. Its independent frozen offline dependencies were retained. Changed-file hashes and committed development SHA are in the separate handoff receipt. Original dirty working files were read as design inputs and preserved.

Evidence directory: `D:/Downloads/evolution-os-smoke-temp`, prefix `model-final-`:

- `before-tests.log`: 16 failed, 4 passed against unchanged prior source; native backend HTTP and browser regression fixtures.
- `first-tests.log`: 7 suites, 75 passed before additional protocol coverage.
- `main-flow-tests.log`: 23 suites, 326 passed before the final lint-only extraction-expression correction.
- `final-main-flow-tests.log`: exact final source, 23 suites, 326 passed, including connection composition, health, Baseline, Experiment/recovery, paired Hidden Holdout, both transports, cache lineage and exact Candidate content.
- `architecture.log`: passed. `lint.log`: one unnecessary regex escape failed; simplified JSON-prefix selection and reran `final-lint.log`, passed.
- `final-build.log`: TypeScript/Nitro production build passed.
- `runner.log`: 11 passed.
- `final-browser.log` and `final-browser-receipt.json`: actual Chromium/CORS/native local HTTP passed through public registry/health/runEvolveAi and exact model x. Plain and wrapped Candidate content hashes both equal `24466b63b35feed750f8c9bd11d406c4c961a99c4ef5479ca60afa040c000ade`; incomplete Candidate rejected. Twelve requests, zero application writes/errors.
- `built-ui.log`: compiled application five routes, mobile390/scrollWidth390, denied localStorage; zero errors/writes.

`ai-final-output.test.ts` uses real HTTP/fetch for both protocols and all three explicit output formats. Tests compare actual Candidate content and SHA-256, preserving literal wrappers inside the artifact. Browser unit fixtures cover both Chat and Responses. Existing CI's Chat browser smoke filename is extended, so no new workflow step is needed. All provider credentials, source content and Artifact IDs used by these fixtures are synthetic.

## Production and deferred external setup

Public build-info at 2026-10-09T07:28:50.792Z returned `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`, main/production: the preceding Chat branch. `current-production-receipt.json` binds subsequent read-only UI checks to the SHA before and after the smoke. Those checks do not verify this local final-JSON branch.

The [main Quality Gate](https://github.com/HG1127/evlove-Studio/actions/runs/37898782652) for e3482e75 completed failure without executing a step. Official check annotation says account payments failed or spending limit needs increasing under Billing & plans. The preceding candidate a6327b7 passed full CI before this platform block; it does not turn the main failure into a pass. Automated Production Smoke was skipped. CI/CD owns independent exact-main production evidence and later complete main CI recovery.

Manual todo: account holder restores GitHub Actions billing/allowance; then CI/CD verifies new runs on exact source. Do not repeatedly retry or modify billing. New branch external CI/production verification remains pending; integration should preserve the draft/unverified state until required gates run. Operator/Vault setup, actual user-selected model/key and original/Candidate cloud export remain deferred.

The real Mission still lacks a newly changed frozen Candidate, paired actual Hidden evidence, Gate F, downloaded accepted-byte hash and reopen receipt. Synthetic Candidate hashes prove parser identity only. Root did not push/deploy, change secrets/configuration, trigger a business Workflow or mutate production Cron.