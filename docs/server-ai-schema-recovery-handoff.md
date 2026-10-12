# Direct model bounded schema feedback handoff

## Increment

Branch `codex/ai-transport-recovery`; runtime `dea6d74e6b628c6278298f13f01b8489f41f5ba8`; parent `fad50a4a9dda470c2e863296c42df673f33bf2fa`. Checkout: D:/Downloads/evolution-os-smoke-temp/server-main-flow-recovery-build-worktree.

Integrate only this runtime and the following documentation commit onto verified candidate `61d319332ce017b7d124a87fc4e4b586d603313c`. Earlier Root transport, reuse, fixture and literal-schema commits are already integrated.

A real saved MiniMax synthetic Candidate request returned provider HTTP 200/completed valid JSON but omitted the required artifacts/summary wrapper. The application correctly rejected it with AI_OUTPUT_SCHEMA_MISMATCH. Candidate construction's content-repair path starts only after a valid output object; it cannot recover this earlier response-shape failure. Eight deterministic regressions failed before this repair; eight safety cases already passed.

## Behavior

Direct providers may receive **one** feedback request only after the operation parser reports a completed invalid task shape. The typed error must originate from that parser. Custom Zod semantic refinements (including all-zero evaluator scores and duplicate IDs), invalid JSON, incomplete/refused/nonfinal replies, transport failures, HTTP errors and forged error codes are not regenerated. The second invalid shape remains rejected; there is no third correction.

The input JSON is captured once. Model/Base URL/key, images, selected protocol and native wire format remain fixed. Auto Responses endpoint fallback selects Chat once and the correction stays on that selected endpoint. All calls share the original AbortSignal deadline, which is checked before correction; no new timeout budget is granted. Feedback uses only internal schema instructions/required field names and never echoes rejected model content, credentials or caller mutation. Gateway behavior is unchanged.

`schema-feedback-once-v1` is added to every direct scoring-route fingerprint. This new recovery policy can affect evaluation results, so historical direct-route scores cannot stand in for fresh measurements. Strict task Zod validation, final-JSON parsing, exact file/source checks and downstream artifact/acceptance gates remain intact. No Candidate/Gate F/Runner implementation, Domain contract, storage migration or production setting changed.

## Local checks

Evidence under D:/Downloads/evolution-os-smoke-temp:

- server-ai-schema-recovery-before.json: 16 cases; 8 pass/8 genuine failures before repair.
- server-ai-schema-recovery-after.json: retained initial post-repair failures from an incorrect public-connection fallback fixture, the newly expected native request count, and fingerprint-property ordering. Corrected fixtures exercise the actual no-protocol route; the runtime was not changed to accommodate the incorrect default.
- server-ai-schema-recovery-release-final-related.json/.log: **12 unique files / 158 pass / 0 fail / 0 skip**, terminal exit 0, including 18 recovery/deadline/no-regeneration cases, actual native HTTP Candidate tests, Baseline, Holdout and identity regressions.
- server-ai-schema-recovery-release-final-gates.json and corresponding architecture/lint/build logs: architecture, full lint, TypeScript/Nitro production build each exit 0.
- server-ai-schema-recovery-initial-gates.json and initial-build.log: first build exit 2 for missing responseFormat in synthetic connection test types; explicit JSON Object fixed the fixture. Initial failure remains preserved.
- server-ai-schema-recovery-development-handoff.json: exact files/commands, committed source hashes and immutable evidence hashes.

Installed Vitest CLI uses maxWorkers=1, D: TEMP/TMP, heap768/semi-space4. Architecture/lint/build ran serially after independent CI's heavy checks. This runtime has no Runner implementation change; the new integrated full CI must still include Runner and browser checks. The earlier exact 61d receipt does not cover this increment.

## Live synthetic evidence and its limits

Existing saved connection revision1: HTTPS api.minimaxi.com, Chat Completions, JSON Object. No Key was supplied, printed or changed. Input is an entirely agent-authored 176-byte HTML fixture; replace only Quantity: 1 with Quantity: 2 while preserving all other bytes. Canonical request SHA-256: `704f2ec86cc65e27bbd82eea201d28d8e9512c6284d7b108cdd7744849784b83`. No real Mission/Artifact identity or user excerpt is included.

Original wrapper failure: main-flow-synthetic-candidate-model-structured-receipt.json; synthetic-candidate-model-wire-shape.json; synthetic-candidate-model-error-classification.json. Provider returned a completed root object lacking artifacts/summary; application returned500. It is an actual response-shape failure, not a failed product test.

Initial runtime-dea6d74 probe returned503/SERVER_AI_UNAVAILABLE; reason was not retained and there is no completed provider wire observation. The helper's realProviderAttempted flag records the intended API preflight, not proof that the provider fetch ran in this particular failed request. Preserve that limitation; no exact network/configuration cause is claimed. Receipt: main-flow-synthetic-candidate-feedback-model-structured-receipt.json.

One diagnostic recheck returned application200 after14,470ms, exactly one artifact with matching source identity/name/MIME, the requested exact content change, and no other byte changes. Original synthetic SHA-256: `5787985406110b2343609f33e427a4b555f9dc81134f65a73ce0738d9719ecf7`; generated synthetic SHA-256: `b3f071a20aa2cc7af0cf55683c50d410afcc8c1019f848c45e5bb25d8d18087f`. The independent local byte hash is used; the model-supplied hash is not trusted. Receipt: main-flow-synthetic-candidate-feedback-model-recheck-structured-receipt.json; wire: synthetic-candidate-feedback-model-recheck-wire-shape.json.

**That recheck's first response was already valid and no correction request occurred.** It proves one valid changed Candidate-shaped response from the saved model, not that this patch caused recovery, that model behavior is stable, or that the new feedback path was exercised by that real provider. Bounded feedback is proven by deterministic tests; live causal recovery remains unproven. No returned HTML was executed, frozen, persisted or accepted. Owned previews were stopped and have no remaining owned listeners. Prior500,503 and subsequent200 records remain distinct.

## CI, production and pending actual acceptance

Previous exact61 independent full CI passed333 unique files/2729 pass/1 explicit skip, architecture/full lint/build, Runner23, native browser fixture paths and compiled readonly UI;419 build hashes remained unchanged. Receipt ci-exact-schema-61d3193/verification.json, SHA-256 `f19b274b957fb318c9dc806e506307dab120633631b09de54ec29fad0a19a5b6`. Root separately audited all34 raw reports and manifest coverage in server-ai-schema-ci61-final-root-audit.json. This proof excludes dea6d74.

At10:17 UTC, CI's actual public build-info GET returned production main `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`. At10:32 UTC Root's public GET timed out (curl28); official authenticated CLI GET project target metadata still returned READY/e3482e75/dpl_9t5CJQXuhD2ibdCGyZ1jwP6DA4Du. The latter is metadata, not application verification. Receipt: server-ai-schema-recovery-production-readonly-receipt.json. No new candidate is deployed or production verified; PR6 remains separately frozen at c24608a and hosted billing/local-CI exception remains pending.

Real project-1790480873333 still requires fresh authorized Baseline/diagnosis, changed frozen Candidate evidence, paired same-Hidden evaluation, Gate F and identical accepted downloaded/reopened file hashes. Synthetic results and stored revision29/Baseline do not replace those receipts. Real user-file cloud-export approval is already pending; no user file was sent to model/Sandbox, no Mission/Job write, migration, production secret change, Cron or deployment was performed. Root hands verified commits to the authorized Git and CI chats.