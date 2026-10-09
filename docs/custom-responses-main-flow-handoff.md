# Custom Responses model main-flow repair

Date: 2026-10-09. Base: `6c58db1eb9391f763529dbd7cf030c15f4ed1271`.

## Observed blocker

A custom Responses connection could pass its browser health check but fail its first structured task. Health used the provider's direct/CORS policy while the structured call unconditionally selected the relay. Providers exposing only Responses also failed when they supported JSON mode or prompt JSON but rejected strict JSON Schema: the old code switched to Chat instead of negotiating the response format at the same endpoint.

## Implementation

- The existing browser entry point is a compatibility shim. HTTP mechanics live in the public `@evolution/adapters` package, with its external response envelope validated by a Zod contract from `@evolution/contracts`.
- Health and task calls now use the same direct/CORS policy. An actual CORS failure still follows the existing relay fallback; this change does not create or open a production relay.
- Format-related HTTP 400 responses negotiate `json_schema`, `json_object`, then prompt JSON on the Responses endpoint. The working format is remembered by protocol/provider/base URL/model. Unrelated HTTP 400, authorization, rate-limit and server errors do not negotiate. A missing Responses endpoint (404/405) retains the existing Chat compatibility fallback.
- All output text parts are joined. Incomplete/failed responses and malformed envelopes fail closed. Task-level Zod validation remains mandatory after any format negotiation. One cancellation signal and the output budget are retained across attempts. Echoed API keys are redacted from adapter errors.
- The format fields follow the official [Responses structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). JSON mode is a transport option; it does not replace the task schema check.

## Reproduction and local evidence

Before the repair, the initial browser-flow regression set had 5 failures and 6 passes. After the repair, 7 relevant suites passed 71 cases, including 25 new adapter/provider regressions. Architecture checking and full Lint passed; the independent-dependency TypeScript/Vite/Nitro build passed.

`scripts/ai-responses-browser-smoke.mjs` is a reproducible Chromium + CORS + native local HTTP test. It bundles the actual registry, health and `runEvolveAi` modules into an isolated fixture page, saves a custom connection and routing policy in a fresh browser context, checks health, negotiates from rejected strict JSON Schema to JSON mode, and validates a multipart task result. It passed with three expected model requests, zero page errors, zero unrelated writes and zero fixture assertion errors. It uses only a fictional key and generated task data. Run it with `node scripts/ai-responses-browser-smoke.mjs`; optionally set `AI_RESPONSES_SMOKE_RECEIPT` to save its receipt.

Evidence files are under `D:\Downloads\evolution-os-smoke-temp`: `custom-responses-before.log`, `custom-responses-independent-tests.log`, `custom-responses-build-independent.log`, `custom-responses-reproducible-browser.log`, `custom-responses-native-browser-receipt.json`, and `custom-responses-build-source-hashes.json`.

Two build attempts with shared dependency junctions failed on Workflow-generated cross-drive paths and shared Nitro cache resolution. Verification was moved to a same-volume checkout with independent, frozen offline dependencies; those failures were retained in the logs. An initial full-dev-browser fixture process terminated with native exit 0xC0000409; its cause was not established. The isolated, reproducible actual-module browser fixture subsequently passed. Neither the failed builds nor the terminated process count as passing evidence.

## Git and CI/CD handoff

Root owns the development branch `codex/custom-responses-flow` and local checks. The authorized Git conversation integrates this verified branch and pushes the intended main SHA. The authorized CI/CD conversation should run full unit tests, architecture, Lint, build, Runner, browser E2E and the new Responses browser smoke, then verify exact-SHA CI/artifacts and production read-only routes. At handoff, production still serves the previously verified main SHA above; its read-only checks do not verify this new patch. Root does not change production configuration, deploy, merge main, or run a mutating Cron.

## Real Mission acceptance still pending

This closes a custom-model invocation blocker. It does not prove a reply from the user's chosen external model or acceptance of Mission `project-1790480873333`. The real flow still needs a changed frozen Candidate, paired current/Candidate execution on the same hidden set, Gate F and reopening the downloaded file with the accepted SHA-256. The recorded operator/Vault setup, custom provider configuration and original-file cloud-export boundary remain separate follow-ups. No original files, real model credentials, production business writes, migrations or cleanup were used by this fixture.

Final local verification: architecture check, full Lint, 11 Runner cases and the independent-dependency TypeScript/Vite/Nitro rebuild passed. The rebuilt application passed five read-only routes, 390px mobile and denied-storage recovery, with zero page errors or attempted writes. Final logs use the prefix custom-responses-final- under the evidence directory. The user service on port 8000 was retained; only the owned test preview on port 8101 was stopped after verification.
