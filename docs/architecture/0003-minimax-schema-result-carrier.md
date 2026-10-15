# ADR 0003: Native MiniMax schema result carrier

Owner: backend direct-model adapter maintainer. Date: 2026-10-15. Status: implementation on an isolated feature branch; release requires exact-commit CI and production authorization.

## Observed problem

Production c24f2d9671aae46ba85245243c1d754ae04e19be executed Run wrun_01M4ZHNG6M9D9SAN74299RF3AA for the approved P1-03. Nine Current and nine Candidate raw measurements completed on the same paper, but the independent Judge returned invalid JSON after its one correction. No valid new Safety verdict, Gate F or accepted download exists. Safe diagnostics classify trailing content; raw private Judge text was not retained, so the exact syntax cause is unknown.

## Decision

For native HTTPS /v1 endpoints api.minimaxi.com, api.minimax.io and api.minimax.cn, exact models MiniMax-M2.7 / MiniMax-M2.7-highspeed, Chat and the selected json-schema response contract, send the existing task JSON Schema as one output-only function parameter schema. Use documented tool_choice=auto. Do not send competing response_format. Existing reasoning separation, endpoint/model/key, complete input, deadline and task instructions remain. Explicit Responses, json-object, prompt-json and custom endpoints keep their requests and route hashes.

The adapter validates the external envelope with Zod, requires one choice and one complete named function result, bounds arguments to 2MiB UTF-8, and returns its exact argument string. It executes nothing. Mixed text/calls, wrong calls, refusals, truncation, nonfinal output and ambiguous alternatives fail closed. If the same single response contains no call, complete ordinary final text can pass the existing strict decoder. No additional provider request or selection among verdicts is introduced.

Both carriers pass the same strict JSON parser and original task Zod schema. Completed syntax/shape failures retain the existing one same-connection correction with full private rejected context and the same deadline. Semantic rejection and valid REVIEW/FAIL are not corrected. New diagnostics expose only fixed carrier/category labels and byte/token counts. The affected scoring route gains minimax-schema-result-v1, preventing reuse of earlier measurements.

## Evidence and limits

The [official MiniMax M2.7 tool guide](https://github.com/MiniMax-AI/MiniMax-M2.7/blob/main/docs/tool_calling_guide.md) demonstrates OpenAI-compatible function parameter schemas, auto tool choice and returned argument strings. This motivates a transport adaptation; it does not prove that a large real Judge call will succeed on the hosted endpoint. No SDK, model provider or infrastructure is added. Contracts/core/harness remain independent of this adapter implementation.

Seven regression cases fail against the prior code because legal final tool results are rejected. Local synthetic tests are not production or Mission acceptance. Production saved credentials must stay server-side; use the existing authenticated ai-health endpoint after release. Do not read back Vercel Secrets to run a local probe.

The reviewed-holdout one-Job-per-scope guard remains unchanged. The completed SDK Run with the old running Job is historical, not live; this change does not repair it. A further real execution requires a normal governed continuation authorized for the unchanged frozen file, original REVIEW and acceptance gates. New code alone grants no retry, Safety upgrade, release or download authority.

## Alternatives and rollback

Repeating the same free-form JSON request after a completed failure is not a new measurement strategy and would violate the existing single-correction limit. Changing models or response formats would change the user-selected connection. Arbitrary tool execution and permissive JSON extraction are unnecessary and rejected. The chosen result carrier keeps the same task contract and uses the provider's documented structured parameter channel.

Rollback is a source release reverting this adapter policy, with its own exact CI/deployment identity. No database migration, stored-data reinterpretation or production secret update is required. Both forward and rollback route identities must be treated as distinct from existing measurements; neither upgrades historical Safety or acceptance.
