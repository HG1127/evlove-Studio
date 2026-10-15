# MiniMax final-content channel handoff

## Actual main-flow observations, 2026-10-15

Production `a1cbab8c5960b4e3dbd30e42354b72abfb78251b` completed the approved fresh Mission Source reconciliation, a full-source MiniMax understanding, and normal Target Ready confirmation. Mission: `project-main-flow-sop-b2663c8f-f695-436a-a219-691ff27fe273`. Original Source: `artifact-76737c87-70b9-4eb3-882d-bc0f3011f894`, 264173 bytes, SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`.

First normal Run `wrun_01M4YS8RM27ANKJVEFCDCYHD7D`, Job `workflow-control-6c62e029-0d6a-4fac-a417-896c7b3d0e2a`, completed Baseline `baseline-server-1792034516143` and Problem. Five current cases bind the exact physical Original; one whole-protection case is unverified. Independent Safety is PASS, rubric score 78. This is diagnosis-only evidence, not whole preservation or acceptance. SDK subsequently failed at the health precheck; the generic control Error did not retain the underlying provider/schema cause. A later same-model synthetic health call succeeded. That success does not establish the earlier failure's cause.

The supported normal failed-control retry created distinct Run `wrun_01M4YT3QYVC3D5TK2H0QKH7TMZ`, Job `workflow-control-ecef0f30-de35-4d6f-ab1a-e87cd79e835a`. It independently repeated the Baseline. New Baseline `baseline-server-1792035402060` failed its Judge: initial and correction Chat replies both ended with `finish=stop` but invalid JSON. The retained safe completion diagnostics report 4980 / 11168 content bytes and 1328 / 2597 output tokens. At revision 14, SDK is completed, Job waiting, Campaign paused at baseline; no Candidate exists. Neither run is live. Old failures and successful historical Baseline remain separate receipts.

Private-safe evidence directory:
`D:/Downloads/evolution-os-smoke-temp/server-ai-selection-20261014/sop-new-mission-authorized-20261015`.
Relevant receipts: `root-same-source-reconcile-a1cbab8-receipt.json`, `normal-understand-a1cbab8-final-receipt.json`, `normal-target-b5-a1cbab8-final-receipt.json`, `first-real-baseline-a1cbab8-evidence-audit.json`, `first-control-health-failure-safe-receipt.json`, `normal-flow-monitor-retry1-0339-safe.json`.

## Scoped request change

The [official MiniMax Chat Completions reference](https://platform.minimax.io/docs/api-reference/text-chat-openai) documents `reasoning_split`: true places thinking in the separate reasoning field, leaving final content separate. The [SDK reference](https://platform.minimax.io/docs/api-reference/text-openai-api) also describes this output switch and the supported M2.7 model family.

Only HTTPS `/v1` endpoints on `api.minimaxi.com`, `api.minimax.io` or `api.minimax.cn`, with exact `MiniMax-M2.7` / `MiniMax-M2.7-highspeed` model IDs, receive `reasoning_split: true` in Chat requests. Altered hosts, ports, credentials, query/fragment paths and custom providers do not infer this native capability. The user's Base URL, API Key, model, protocol and selected response format are retained. Explicit Responses requests remain unchanged. The applicable scoring route includes a versioned native-output policy, so old measurements cannot qualify under this new request policy; unaffected fingerprints remain byte-identical.

This is protocol alignment, not proof that reasoning caused either real JSON failure: the original rejected final text was not retained for local inspection. Strict final-output decoding and Zod validation remain required. Separated reasoning never supplies a missing final result. Invalid JSON still fails after the existing single same-connection correction with unchanged original context and deadline. No score, safety, protection, Hidden, Gate F or delivery authority changes.

## Validation and continuation

The deployed parent reproduction runs the new request-composition suite with synthetic isolated fetch: 22 tests, 14 passed / 8 failed. The own modified gateway was restored byte-for-byte in finally. The first earlier red attempt's exit/log remain retained; its configured-default JSON report was overwritten by the following 16-test green run, so the explicit parent reproduction is the countable red report. Final related tests, architecture check, full lint, TypeScript/build and immutable source/build hashes belong in the temporary final handoff.

Full exact-commit CI and delivery stay with the dedicated Git/CI chats. After actual deployment and SHA readback, continue the same paused Mission through its normal control API with a stable key, fresh Baseline, diagnosis, changed frozen Candidate, Experiment, same-Hidden paired evidence, Gate F and exact accepted download/reopen. No existing Job repair, Cron, migration or secret change is included. PR #22 and central31 holds remain preserved. No complete real Mission acceptance is claimed by this increment.