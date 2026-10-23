# AI request usage evidence

Owner: Evolution OS maintainers. Date: 2026-10-24. This follows the existing stack and package direction; no architecture exception is introduced.

## Problem and decision

The real evolution pilot could not establish actual operating cost: the AI gateway retained only parsed task output, dropping provider usage, while legacy run records contained an unmeasured `cost: 0`. A malformed task JSON response and a connection failure may cause additional requests; counting only a final successful response would undercount the workload. Historical zeros remain unmeasured and are not upgraded to actual billing evidence.

Contracts define versioned request starts, observed results and token counters. Core reconciles exact start/result identities, rejects conflicting or missing records, and reports observed token subtotals separately from complete coverage. Missing totals are not inferred. Invalid counters or a forged complete status do not establish coverage. Reasoning and cache-read counts remain details within output/input rather than being added to total tokens again. Even genuinely observed zero tokens do not establish a zero monetary bill.

The provider adapter exposes an optional observer around every physical HTTP attempt while preserving the existing one-retry connection policy and deadline. Responses, Chat Completions and installed AI SDK 7.0.107 counters are normalized with Zod. SDK generation records explicitly lack visibility into internal physical retries. No pricing estimates or undocumented provider cost fields are treated as actual billed money.

Apps bind recording to trusted Mission, control Job, phase and checkpoint identities through an asynchronous execution context. Model payloads do not supply this context. Within an enabled scope, each direct HTTP attempt must have a durable start before transmission; an SDK generation has a generation-level start instead. Calls outside a scope are not silently attributed to a Mission. An end-record write failure leaves a visible unmatched start and does not cause an otherwise completed request to repeat just for telemetry. Schema-correction retries remain separately counted even if their prior task output was unusable.

Existing canonical append-only events store the hash-bound metadata. Readback validates record hash, event identity, Mission/Job binding and timestamp. A bounded event listing cannot claim complete usage coverage unless its required manifest is complete. The records contain usage counters, route/model identity and request timing, excluding request/response content, prompts, credential fields and arbitrary provider metadata. This reuses the existing storage and permissions and requires no database migration.

## Real diagnostic evidence

A registered diagnostic Job `ai-usage-observation-ae8adc3c-d329-4cc9-82a6-11231a871faa` sent only fixed diagnostic text to the currently configured AI service. No SOP, HTML, CSS, JS or reserved final paper was supplied. One physical request returned 426 input tokens and 89 output tokens, total 515; reasoning/cache details were retained without double counting. Both canonical start/result events were read back and validated. The diagnostic Job completed as a transport/accounting check, not an accepted user delivery.

The immutable receipt Artifact `usage-observation-ai-usage-observation-ae8adc3c-d329-4cc9-82a6-11231a871faa` was written and physically read back with authoritative Mission/Job metadata and SHA-256 `4ee78d23ac25a53714bb603c4c829b295b4447bf61b8779718df9ac5f386fec6`. Token evidence is complete for that diagnostic. Monetary billing evidence remains unavailable. Its Job and receipt are explicitly marked diagnostic-only and excluded from business-benefit or accepted-delivery evidence.

## Scope and remaining proof

This instrumentation does not establish a deployment, an accepted task, actual monetary cost, a latency improvement or lesson transfer. Request duration is not end-to-end task duration. The future controlled workload still requires the original acceptance gates, deployment of the same frozen bytes, independent sufficient per-arm task samples, actual billing and the pre-reserved unseen lesson/no-lesson comparison. None of those requirements is relaxed by this diagnostic.

No new full-file Vercel Sandbox upload or execution entry was enabled. That separate authorization remains pending. Existing AI-body consent and the current model route are preserved.

Validation: 174 related unit/integration tests, all 11 Runner tests, architecture checks, changed-file lint and production build passed, alongside the actual metadata persistence/readback diagnostic above.

Rollback: remove the application recording scope to restore the original transport route. Retain all recorded events and signed receipts; treat the resulting measurement gap as unknown. Do not synthesize successful billing from token estimates or legacy run costs.

References: [Chat Completions usage fields](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create); installed version-matched `node_modules/ai/src/types/usage.ts` and `node_modules/ai/src/generate-text/generate-text.ts`. The latter calls the model-start callback outside its internal retry, so generation-level callbacks cannot prove physical retry coverage.
