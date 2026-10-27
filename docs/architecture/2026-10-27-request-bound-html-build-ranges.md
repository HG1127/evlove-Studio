# Request-bound body ranges for HTML construction

Status: accepted, explicit opt-in. No architecture exception.

## Measured failure and limits

Confirmation eleven used `683b8ad`, one initial Candidate and the existing construction correction. Its final error reports a missing/non-unique body anchor. The exact reported sentence occurs twice in the physical Original, once in a search attribute and once in body text; the issued body index has one complete matching node. The raw failed proposals are unavailable, so their actual positions, whitespace and exact first failure cannot be reconstructed.

A static counterexample on those real Original bytes reproduces the same error when conflicting explicit positions accompany the exact sentence. Omitting both positions correctly binds the single issued body node. This is not an exact replay of the lost proposal. Seven actual MiniMax requests have matched receipts, totaling 444,136 tokens; there was no frozen Candidate or accepted output.

## Decision

Add optional `experimentPolicy.htmlBuildAnchorValidation = issued-body-ranges-v1`. It is selected independently for a new trial; absent flags preserve legacy behavior. The backend supplies `bodyAnchorPolicy` only when the explicitly authorized complete HTML body context exists.

For selected Targets, a request-bound build response validator requires complete raw `before` values from the actual issued body index. A unique body match can omit both positions; genuinely repeated body nodes require an exact supplied pair. Conflicting, partial, invented or repeated ranges are invalid model output. Unknown/duplicate/missing Targets are rejected before materialization. Arbitrary model positions are never silently rewritten. New `after` fragments retain existing text-edit expressiveness, and the same physical parent/hash, code, paragraph, renderer and quality checks still apply before freezing and delivery.

The existing single provider schema correction receives the matching physical ranges. Its feedback retains only 240 characters per issue, so the measured ranges and the omit/copy instruction appear first. No additional provider retry, construction correction, Candidate, shared repair or time window is introduced. All physical attempts keep normal usage records. The old strict matcher and its legacy explicit-position behavior remain unchanged.

No extra raw source, scripts/styles, keys or independent final questions are sent. The range hints are already-issued metadata; only the server-owned current Target context may bind them. The Domain exact-edit resolver remains pure and platform-independent.

## Verification

Local coverage includes legacy parsing, the real-source static counterexample, metadata/body ambiguity, explicit repeated body selection, conflicting/partial positions, missing or stale indexes, Target identity, opt-in/consent composition and the actual provider-request correction chain with an injected HTTP provider. The tests verify that useful positions survive feedback truncation and that a second invalid response stops. These observations establish no new real SOP acceptance, actual business benefit or causal lesson transfer.

Final local checks passed 265 related tests across 18 files, 11 Runner tests, TypeScript/production build, architecture check and changed-file lint. A selected HTML Target can coexist with an ordinary native spreadsheet Target; its blueprint is not reinterpreted as body edits. The new opt-in policy still requires real execution.
