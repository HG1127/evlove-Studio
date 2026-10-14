# Direct AI completion failure diagnostics

## Scope and actual failure

The normal real Run `wrun_01M4X40Y35FY8S4EY3HVH4Z0J5` on verified production `a07b53971a3b892613ea8b8c2cd926286d412c46` ended with Baseline `baseline-server-1791978735235` failed at the independent Judge JSON boundary. The root object was not closed. Its stored state has no valid Judge/Safety result and no frozen Candidate. Provider completion status, finish reason and output usage were not retained, so the actual reason for this malformed response remains unestablished.

Evidence: D:/Downloads/evolution-os-smoke-temp/real-independent-safety-observation-1791978912.json. The prior real Safety FAIL is preserved separately; this new missing verdict does not supersede it with a passing result.

## Change

Initial and single-correction failures now retain schema-validated completion metadata reduced to fixed status/finish categories, native first-choice content UTF8 byte counts, and safe nonnegative output-token integers no larger than 1,000,000,000. Unknown metadata becomes `other`, absent metadata `missing`, invalid envelopes `invalid`. Provider messages, IDs, output excerpts, reasoning and unknown detail fields are excluded. Private WeakMap metadata retains local error identity and does not grant retry authority. Both actual phases remain distinguishable when the correction fails.

Initial HTTP failures and HTTP-200 provider error envelopes use fixed messages; an encoded credential or task excerpt in provider error text cannot reach the public error. Native tool/filtered and length errors also use fixed messages. HTTP status and existing availability classification remain usable.

The correction policy is versioned as `schema-feedback-once-v6-completion-diagnostics` to bind the changed route. Completed syntax/shape correction still has exactly one attempt under the same protocol, format, deadline, complete original evidence and private rejected-final context. Valid FAIL/REVIEW remains unchanged. Nonfinal, refused and semantic-invalid output remains rejected. No JSON repair or acceptance promotion is introduced.

## Output budget and remaining acceptance

Chat currently leaves the output-token parameter unspecified; Responses sends `max_output_tokens=10000`. This change does not infer token truncation from incomplete JSON or guess a new provider capability. The official [MiniMax Chat API](https://platform.minimax.io/docs/api-reference/text-chat-openai) documents a completion limit and `length` termination, but the actual failed Run did not retain that termination. A future budget change must choose one parameter supported by the selected connection, preserve it across initial/correction and bind its identity.

Related checks and complete exact-commit CI/delivery are recorded separately. Synthetic diagnostics regressions do not prove a real Judge, whole protection, changed frozen Candidate, Experiment, same-Hidden validation, Gate F or exact accepted download/reopen.

## Complete CI failure and bounded BYOK feedback repair

Both initial complete hosted gates for `742c9c3` failed at the same existing BYOK assertion requiring the actual safe output-token count `24000` in a known `length` error. The push Run `38564937496` / Job `115855099154` measured 408 unique files, 4614 passing assertions, one failure and one explicit live-Sandbox skip. The PR Run `38565013451` / Job `115855355183` also failed the unit stage; its raw evidence is retained by the CI owner. Later build/browser gates were not passed. This functional failure is not a hosted infrastructure outage and does not authorize local fallback.

The follow-up preserves the unchanged BYOK assertion and restores useful native token feedback only for safe nonnegative integers no larger than 1,000,000,000. Missing usage stays missing; invalid or oversized values remain rejected/omitted. Arbitrary finish/provider text remains excluded. `chat-output-v2-bounded-diagnostics` binds the changed adapter route. Related checks add the previously omitted real BYOK consumer; a fresh complete exact-commit gate is still required before delivery or the next real Run.