# Retain safe provider completion observations without rewriting usage history

Status: implemented for validation, 2026-10-28.

The sealed C15 trial has two HTTP-200 planning responses that ultimately failed JSON parsing. Their response IDs, token counters and timings are bound to actual usage receipts, but the collector did not retain provider completion markers. The raw planning responses were not copied. Those historical records cannot distinguish a provider-reported length limit, an ordinary stop with malformed JSON, or another completion condition. Token counts cannot supply the missing reason.

## Decision

New observations use `ai-provider-usage-v2` and require a nullable `completion` field. Contracts continue to read the exact strict v1 schema as a separate discriminated variant. A legacy receipt gains no invented field, changed identity or re-signed result. A second v2 result for an existing v1 call remains a conflicting receipt, not a backfill.

The pure adapter selects only allowlisted completion enums from the actual protocol: first-choice `finish_reason` for chat completions, `status` and `incomplete_details.reason` for Responses, and the installed SDK's unified `finishReason`. Unknown nonempty strings become `other`; invalid or absent fields remain unavailable (`null` when none are observable). It never retains raw vendor reasons, output, reasoning text, request content, headers, credentials or arbitrary metadata.

Backend composition records these fields in the existing request-bound start/result ledger. SDK success/error paths supply their available unified marker while retaining the original result/error and the existing opaque SDK-generation granularity. No request, retry, model selection, generation budget or acceptance path changes. Completion metadata is diagnostic: a reported `stop` does not prove valid JSON, correct content, accepted delivery, human benefit or actual monetary cost.

The existing record hash covers the v2 metadata as well. A changed reason under an old hash is rejected. The outer event/ledger format and generic JSONB storage remain unchanged; no database migration is needed. Updated readers accept both observation versions; older strict readers need the new decoder before consuming newly emitted v2 records.

## Validation and limits

Checks cover strict v1 byte identity, required v2 null/metadata, privacy filtering, protocol isolation, mixed-version accounting, conflicting backfills and hash tampering. A malformed JSON response with a provider `stop` marker still follows the original structured-output correction and validation, demonstrating that metadata cannot substitute for task validation. SDK receipts still cannot prove physical retry coverage or actual billing.

The current decoder also reads the real sealed C15 event records with their original hashes and token summary, without inventing completion metadata. This compatibility check makes no model or Sandbox requests and changes no remote state. The historical JSON failure's precise cause remains unknown. A later bounded actual trial must supply new observations; all three original real-effect requirements remain unmet.
