# Native text byte integrity and request-bound repair anchors

Owner: Evolution OS maintainers. Date: 2026-10-26. These remain adapter/application boundary changes within the existing stack.

## Actual observations and limits

The explicitly extended confirmation exhausted its sole targeted repair when a returned body anchor omitted a character from its parent-bound identifier. Zod accepted the outer JSON, but physical edit resolution later rejected the ID before any file write. The real Workflow stopped with acceptance failed at 1/1; that failure is not retried by this repair.

A separate offline audit found zero U+FFFD characters in the physical Original and Candidate or their parsed body text, compared with 8 and 11 in earlier received rendered-text reports. Source corruption cannot be concluded from that discrepancy alone. The exact browser/log origin remains unproved; no user HTML is re-executed to manufacture a passing result. Existing report hashes and judgments remain historical.

## Byte-verified observation transport

The trusted guest kernel now serializes its bounded observation to UTF-8 bytes, computes SHA-256 and byte length inside the guest, and emits an ASCII JSON envelope containing canonical base64. The adapter validates the versioned envelope with Zod, enforces size bounds, verifies length/SHA/canonical base64 and decodes UTF-8 strictly before validating the observation. A changed, missing, legacy or invalid byte stream remains unavailable. Existing literal replacement characters are preserved; the adapter never strips or repairs document text.

This removes dependence on reconstructing multibyte text across Unicode log chunks and adds a producer-side byte binding before host fingerprints. It does not claim to rule out actual browser DOM corruption or semantic defects. The kernel SHA changes, so existing execution fingerprints require fresh observation rather than silently reusing prior assessments. Production Baseline reuse also rejects native receipts from an older kernel before consulting the existing cache policy; non-native caching remains unchanged. The vendor-specific expected kernel stays in app composition, keeping Harness independent. Unknown profiles, physical Original/Candidate identity, network-denied isolation, no guest credentials and awaited VM cleanup remain required.

## Request-bound edit validation

The repair contract reads the actual production `candidate.artifacts` mutation modes and full supplied anchor index. Before physical mutation, its Zod parser validates nested body-edit JSON, target identity/completeness, exact allowed anchor IDs and uniqueness. It never normalizes, shortens, fuzzily matches or replaces an unknown ID. The existing full parent SHA stays server-owned, and physical edit resolution remains strict as a second check.

An invalid returned ID now enters the existing single schema-correction path, whose bounded error tells the provider to copy an exact supplied ID. This adds no targeted repair allowance, extra correction loop, new model or fallback normalization. Two invalid responses fail. Provider transport/auth failures retain their existing non-schema handling. Mocked-provider tests verify both a corrected response and the two-response stop; a production-payload test prevents a mistaken context field from bypassing the binding.

## Evidence status

Local tests check every possible byte split of a multibyte document's ASCII envelope, retain a genuine replacement character, reject incorrect lengths/hashes/payloads/UTF-8 and legacy output, and await VM shutdown on failure. The strict physical-parent and protected-code tests remain required. No new AI/Sandbox request, independent final execution, accepted output, user benefit or causal transfer is inferred from these engineering repairs. The complete actual failure and signed metadata are recorded in [the acceptance log](../real-evolution-acceptance.md).

All 209 related tests across 16 files, all 11 Runner tests, architecture checks, changed-file lint and the complete TypeScript/Vite/Nitro build pass. The manifest retains the two intended Workflow modules and 11 step-module records without private diagnostic sources. These final boundary fixes have not been rerun on the real SOP after the authorized repair failed; the trial remains stopped at 1/1 and its outcome is not changed.
