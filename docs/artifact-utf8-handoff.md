# Exact UTF-8 Artifact handoff

## Scope

Base: `249dd8057c3b4a1a874c9d891d419e23a4213563`.
Branch: `codex/bom-artifact-text`.

A valid UTF-8 BOM was removed by default `TextDecoder` and `Blob.text()` reads. This made the exact-parent SHA comparison fail and rejected an otherwise valid frozen/rendered file. The shared `@evolution/adapters` decoder now preserves the BOM, CRLF, Unicode and byte views and continues to reject malformed UTF-8. Server parent/frozen/materializer/current-file roundtrip and browser rendered-text/roundtrip boundaries use it. JSON syntax validation removes one leading BOM from its validation view only; Snapshot and physical bytes keep it.

Existing Source/Target binding, Snapshot hashes, receipt names/MIME, full file SHA-256, size and readback comparisons remain enforced. Parsed file indexes, ZIP/XML parsing, legacy encoding detection and provider protocol handling are outside this patch.

## Local evidence

Evidence directory: `D:\Downloads\evolution-os-smoke-temp`.

- `artifact-bom-before-tests.log`: 8 failed / 2 passed against unchanged parent; failures include parent byte comparison, frozen construction, rendered and browser readback.
- `artifact-bom-focused-tests.log`: 20 passed after repair.
- `artifact-bom-final-tests.json` and `.log`: 18 suites, 219 passed, zero failed.
- Tests use native Blob bytes and SHA-256. A changed HTML/JSON Candidate retains the original BOM, line endings and untouched Unicode; its full bytes/hash are checked after persistence and Gate F file verification. Malformed UTF-8 and removed/replaced bytes remain rejected, even after receipt size/hash rebinding.
- Architecture and full lint passed. Build, Runner and UI receipts are finalized in `artifact-bom-development-handoff.json` after the final checks.

This is local boundary/regression evidence using synthetic files and an injected in-memory Artifact Store. It is not a real user Mission, fresh real-provider Baseline, paired Hidden execution or a completed Gate F business acceptance.

## Delivery and deferred boundaries

Git/CI own integration and independent validation of an exact candidate. Root does not push main, deploy or alter runtime secrets/configuration. GitHub Actions billing/allowance is currently a manual account-owner task; a blocked hosted check remains UNVERIFIED. Current public production was observed on `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`; readonly checks of that SHA do not prove this branch.

Real Mission `project-1790480873333` remains pending a user-selected custom model/key, operator/Vault verification and authorized original/Candidate cloud export. Do not substitute regression totals or synthetic fixtures for actual original/frozen/download SHA evidence, same-Hidden execution and Gate F acceptance. Do not trigger mutating production Cron without new explicit approval.