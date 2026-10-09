# Opaque custom model ID handoff

Date: 2026-10-09. Base development SHA: `a1f7d13b6e178b8463e5b04d59b8743d00725b1f` (the separate Responses transport repair).

## Observed main-flow blocker

The registry inferred that real model IDs must have at least four characters, with a special case for short names containing digits. Explicit custom IDs such as `x`, `llm`, `g` and `GPT` could be removed from saved/default/tested lists, refused by connection testing, or silently replaced by a different route. This contradicted the backend settings boundary, which already accepted any trimmed nonempty model ID of at most 200 characters. The pre-fix new registry regression suite recorded 8 failures and 3 passes.

## Repair and invariants

The shared `AiModelIdSchema` in `@evolution/contracts` retains the existing backend wire contract: trim surrounding whitespace, require a nonempty string and cap it at 200 characters. Model IDs remain opaque and case-sensitive. The legacy `isPlausibleModelId` export is a compatibility shim using that contract. Saved/default/tested models, explicit routing, tested choices, pruning and measured latency retain short IDs. Model availability remains determined by actual provider responses, not by the length of a name.

The combobox keeps in-progress search text local until the user commits it; Enter/selection commits a valid ID and Escape cancels. Short saved/tested IDs remain selectable. Empty/oversized values still fail the boundary. The backend default-connection schema references the shared field without changing its wire version or validation limits. No domain rules move into React, no dependency direction changes and no existing provider configuration or production records are rewritten.

## Local evidence

Ten related suites passed 95 cases, including 31 new contract/registry/UI cases, the previous Responses regressions, backend connection/composition/health and gateway cases. Architecture check, full Lint and 11 Runner cases passed. The portable Responses browser smoke also passed with `AI_RESPONSES_SMOKE_MODEL=x`: actual Chromium, actual registry/health/runEvolveAi composition, CORS and a native local HTTP provider recorded the exact model `x` in all three expected health/format-negotiation/task requests. There were zero page errors, fixture errors or unrelated writes. The provider and key were fictional; no user files were sent and no real Mission acceptance is claimed.

The isolated D-drive verification checkout has its own offline frozen dependencies. Evidence is under `D:\Downloads\evolution-os-smoke-temp`, using the `custom-model-ids-` prefix. `custom-model-ids-before.log` retains the failing reproduction; `custom-model-ids-final-focused.log`, `custom-model-ids-final-architecture.log`, `custom-model-ids-final-lint.log`, `custom-model-ids-final-runner.log`, `custom-model-ids-native-browser.log` and its JSON receipt hold the completed checks. Build and built UI results are recorded in the final handoff receipt.

## Integration and remaining real acceptance

Git and CI/CD conversations own integration/push and exact-SHA hosted CI/production read-only verification. The preceding Responses branch/PR remains a separate candidate until authoritative main/CI evidence says it has merged. This branch should be integrated according to the current remote state, without replacing the CI workflow changes from that candidate. Run the portable model browser smoke both with its default ID and with `AI_RESPONSES_SMOKE_MODEL=x`.

Real external model configuration, durable operator/Vault setup and the recorded original-file cloud-export boundary remain pending. Mission `project-1790480873333` still needs a changed frozen Candidate, paired current/Candidate execution on the same hidden set, Gate F and an exact-hash downloaded/reopened artifact. Unit counts, CI and synthetic model probes do not replace that acceptance. No production mutation, migration, deployment, credential change or mutating Cron was performed by root development.

Final local verification: the independent-dependency TypeScript/Vite/Nitro build passed. Five rebuilt read-only routes, 390px mobile and denied-storage recovery passed with zero page errors or writes. A separate real settings-page Chromium check clicked the actual Test x button against the local fictional provider, recorded its exact model x request and retained defaultModel/testedModels/lastTestStatus in the fresh browser context; there were no unrelated writes or page errors. Evidence: custom-model-ids-settings-browser.log / receipt JSON and custom-model-ids-final-built-ui.log. Only the owned preview on 8102 was stopped after checks; the existing user service on 8000 remained PID2840.

At final local handoff, official GitHub PR #2 state was MERGED, candidate 6a854f448343ea7d2d021d17d5df83d5179ce9ea, main merge 7f7354f81de249858a4207755d340d06af2cfd54. Its two candidate Quality Gate runs (37890939893 and 37890920080) succeeded. Accurate main/production verification is owned by the CI/CD conversation and is separate from this local short-ID patch.
