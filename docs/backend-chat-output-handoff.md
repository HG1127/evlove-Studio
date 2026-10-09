# Compatible Chat output boundary handoff

## Scope and main-flow relevance

The default user-defined backend model uses Chat Completions. A successful HTTP status previously allowed an error body, an explicit truncated/filtered/tool response, or a refusal to be parsed as a successful task when its content happened to match the task schema. Browser task calls had the same problem, and health probes could label nonfinal replies usable. This patch closes that observed model boundary before Baseline, Candidate construction or independent judging consumes it.

`@evolution/contracts` now defines the consumed non-streaming Chat envelope with Zod. `@evolution/adapters` owns its public decoder. Backend and browser compatibility shims use that decoder while retaining their own JSON/task Zod validation. Explicit backend protocol, response format, timeout, redirect policy, images and request budgets are unchanged. Browser schema-format negotiation and correction of genuinely invalid JSON/task schemas remain available; failed provider envelopes do not enter schema repair.

Compatible providers omitting finish_reason, using null or a provider-specific final label remain supported. Recognized nonfinal length/content_filter/tool_calls/function_call and refusal signals are rejected even alongside parseable task JSON. Legacy choices.text, text parts with omitted type and Responses objects returned at Chat endpoints remain browser compatibility paths. The backend retains its explicit Chat shape. Error messages redact echoed credentials.

The [official Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) describes stop as completion, length as exhausted output, content_filter as omitted content, and tool_calls/function_call as tool invocation; refusal is separate from assistant text. We preserve compatible metadata and validate fields actually consumed rather than requiring all official provider fields.

## Score and cache lineage

Backend Chat/auto scoring identities include `chat-output-v1`; explicit Responses retains its prior Responses output version and Gateway identity is unchanged. Compatible browser scoring routes include the same decoder version, and persisted task-result cache v2.9 ignores v2.8 results. Old results must not bypass the stricter output boundary. API keys and timeouts remain excluded from scoring identity. No stored Mission, artifact, history or production blob is deleted.

## Local evidence

Development branch: `codex/backend-chat-output`, based on `0db7b14ca4086631de71c209b188fde1a7bb2b75`. Managed source is under `C:/Users/Administrator/.codex/worktrees/backend-chat-output/evlove-studio-v3.0-6f145fe0-source`.

The existing owned D-drive build checkout was verified against the previous source hash receipt and advanced to that committed base before receiving this patch. Its independent frozen dependencies were retained. Final changed-file hashes must match the managed source; source SHA and hash receipt are recorded separately after commit. Original dirty development work was preserved.

Evidence directory: `D:/Downloads/evolution-os-smoke-temp`, filenames start `backend-chat-`:

- `before-tests.log` and `first-tests.log`: C-drive dependency resolution failures; no assertions executed.
- `before-native-tests.log`: regression fixtures against unchanged base; 20 failed, 3 passed. This is a Vitest regression run, not a native transport receipt.
- `focused-tests.log`: 10 suites, 113 passed.
- `main-flow-tests.log`: 20 suites, 288 passed; backend encrypted/default connection composition, runtime health, Baseline, Experiment/recovery, Hidden Holdout, browser routing/cache and both protocol decoders.
- `architecture.log`, `lint.log`, `build.log`: passed; full production TypeScript/Nitro build.
- `runner.log`: 11 passed.
- `browser.log`: initial synthetic fixture mistakenly selected Responses while writes allowed only Chat; corrected before final validation.
- `browser-final.log` and `browser-receipt.json`: actual Chromium CORS/native local HTTP passed using exact model x. Health, registry route and public runEvolveAi passed; length/filter/tool/refusal/body-error rejected; failed health rejected, nine requests, zero application writes/errors.
- `built-ui.log`: compiled app rendered five routes, mobile width390/scrollWidth390 and denied localStorage; zero errors or writes.

`ai-chat-native.test.ts` uses an actual local HTTP listener and fetch for all three explicit output formats, nonfinal HTTP200 replies, failed health and 401 classification. Neither native fixture nor browser fixture uses real credentials or sends original user files. CI should run `node scripts/ai-chat-browser-smoke.mjs` with an optional `AI_CHAT_SMOKE_MODEL=x`; existing Vitest already includes new unit/native tests.

## Production evidence and limits

At 2026-10-09T07:04:29.232Z public build-info and remote main both returned `5327de6a26d6ca38db93d404b22d524246a707dd`. This is the previous Responses patch; full exact-main verification is owned by CI/CD and ongoing. This read does not verify the new Chat branch. After integration, CI/CD must collect full candidate/main CI, tested build hashes and exact-SHA production read-only evidence. Root did not push main, deploy, change keys or trigger production Cron.

The real Mission remains pending: no new Candidate/frozen artifact, paired real Hidden run, Gate F or downloaded-byte/reopen receipt is claimed. Missing operator/Vault configuration and the user's actual model/key are deferred external setup. Synthetic native/browser fixtures prove transport behavior only.