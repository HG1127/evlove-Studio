# Request-issued HTML build node selectors

Status: accepted, 2026-10-27.

## Actual failure

Confirmation thirteen used `4e55911`, refreshed current-project credentials and the unchanged full SOP contract. Real Sandbox/Chromium start preflight passed; construction then failed before a frozen Candidate existed. Both physical constructor responses were copied locally and matched to canonical provider receipts.

The first response contains 48 edits: 42 select unique complete body text, while six omit positions for short text shared by multiple real nodes. One such text occurs in 17 issued body nodes. The existing range policy correctly rejects all six. The single schema correction returns 57 edits: 44 unique, six ambiguous and seven absent from the issued index. Both rejected responses, their hashes, the failed Mission and unused 0/1 repair budget remain unchanged. No intended occurrence may be inferred from these rejected proposals.

## Decision

Add the optional `htmlBuildAnchorValidation: "issued-body-nodes-v1"` policy. It explicitly selects `mutationMode: "html-build-body-node-edits-v1"` for HTML with complete authorized body context. Absent selection and `issued-body-ranges-v1` retain their previous protocols. Missing body consent for the new mode stops before a provider call; the existing deterministic exact-plan path and other file types remain available.

The new Zod blueprint is `{kind:"html-build-body-node-edits-v1",edits:[{anchorId,after}]}`. The model copies IDs from the existing complete, full-parent-SHA-bound body index. The server validates exact Target and node identity, rejects unknown/stale/shortened/duplicate IDs and model-supplied `before`, offsets or parent/hash fields, then supplies the issued `before/start/end`. Pure Core conversion returns the existing strict `text-edits` representation. The materializer still rereads and verifies the full physical parent before any write.

`after` retains the existing raw replacement semantics. This is deliberately distinct from the existing plain-text repair blueprint: paragraph/list insertion, inline HTML, entity bytes and ordinary markup changes remain possible under all existing protection and layout checks. Selecting a single occurrence is explicit, never fuzzy matching, automatic relocation or conversion of an ambiguous old response. All Targets unchanged remains rejected by the existing materializer; a genuinely unchanged text Target can still be preserved beside another changed Target.

The builder's complete-body and output instructions select the new protocol consistently. The provider's existing one schema correction remains the only malformed-output retry; malformed JSON feedback names the selected protocol. The existing pre-write construction correction, shared repair debit, independent paper, time window and quality/Safety/native/Gate F gates are unchanged. No new trial is implied and no failed record is reinterpreted.

## Architecture and evidence

Contracts owns the optional selection and Zod blueprint. Core owns deterministic ID-to-range conversion. Backend composition owns the authorized context, provider parsing and physical materializer integration. Cross-package imports use public `@evolution/*` entries; Core/Harness gain no external I/O. There is no schema migration or UI change.

Local tests cover exact selection among repeated text, entity/Unicode bytes, raw markup and paragraph insertion, old range/repair compatibility, mixed native formats, unchanged Markdown, missing consent, changed full parent, duplicate IDs and same-byte frozen readback. A static probe on the actual Original preserves the historical six rejections and explicitly selects one of 17 nodes with unchanged surrounding bytes. It retains 57/57 original code blocks; a long replacement in an actually covered paragraph still fails the existing 240-character construction budget. The initial probe chose an out-of-scope paragraph and remains recorded; the fixture was corrected, not the product policy.

These are construction and identity checks. A later independently registered real model trial must still generate its own proposal and pass all original acceptance gates. No accepted delivery, human/business improvement or causal Lesson transfer is established here.
