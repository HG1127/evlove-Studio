# Return source-owned correction hints for invalid issued node IDs

Status: implemented for validation, 2026-10-28.

C19's two physical MiniMax construction replies both contain parseable JSON and pass the outer build-result schema. Exact replay against the Original body index rejects the first reply for one unknown node ID: its end position does not name an issued node. The existing single schema correction then returns 27 shortened IDs without the source-hash suffix, all still invalid. No Candidate was frozen, no candidate validation or blind final ran, and the trial remains unsuccessful.

## Decision

Improve request-bound correction feedback without changing the accepted protocol or matching rules. For a shortened or incorrect-suffix ID whose physical prefix uniquely matches an issued node, report that complete source-owned ID. For an unknown range-shaped ID, give at most two complete issued IDs near its requested start and require the model to recheck their supplied `before` text. Unstructured invented IDs get the complete-index instruction without a guessed target. Duplicate valid nodes receive a distinct one-replacement-per-node error.

These are suggestions in an error, never automatic rebinding, fuzzy matching, source selection or permission to combine nodes. Every unknown/shortened/duplicate ID remains rejected. A subsequent model response must explicitly choose a valid exact ID, after which all existing source/hash, paragraph, component, protected-code and frozen-byte checks still run. The original one schema correction, one construction correction where applicable, population/repair/time bounds and all acceptance thresholds remain unchanged.

Hints use only the current Target's already supplied body index. No new source read, body upload, raw script/style, key, final question or provider call is introduced. Complete IDs remain intact within the provider's existing 240-character issue envelope; optional hints are dropped instead of cutting an identifier. This is backend boundary formatting and needs neither a new storage protocol nor an architecture exception.

## Validation and limits

Static replay of both actual captured replies still rejects their unchanged IDs. The new first error includes genuine nearby Original IDs; shortened-prefix feedback supplies complete current-source IDs. Historical formal SHA-256 `2b840672023c529e6ccdfec28c5880be04a443ddf06f4b48cd6d803176b9698a` and the spent trial remain unchanged. No user HTML/JavaScript is executed on the host.

Tests retain mixed HTML/range/native Target behavior and the existing one-correction bound, and cover complete-source hints, unknown/duplicate rejection, exact valid ID acceptance and the 240-character envelope. Combined related verification passes 267 tests in 13 files. The replay proves more actionable feedback while preserving rejection, not that a future real model will correct its selection, pass the SOP or establish business benefit and causal Lesson transfer.

The final TypeScript/production build, architecture/changed-file lint and all 11 Runner tests also passed. These engineering checks do not replace a new independently registered real model confirmation.
