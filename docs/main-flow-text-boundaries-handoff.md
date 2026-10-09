# Main-flow text Artifact boundaries: integration handoff

## Branch stack

- Base: `249dd8057c3b4a1a874c9d891d419e23a4213563`, first Server Candidate construction recovery.
- UTF-8 source commit: `009ba8fc93e6e3857160d6677a8795fe75700fbd`, branch `codex/bom-artifact-text`.
- Parallel format source: `579c6da18b48862ae74e09f4122d6bfd94d24535`, branch `codex/accepted-text-format`.
- Locally combined code: `a895cc4`, branch `codex/main-flow-text-boundaries`; format cherry-pick applied without conflict and retained BOM decoding.

Git integration must apply the BOM commit then the combined format commit to its existing candidate containing 249dd805. Do not reapply the parent chain or both copies of the format commit. The final documentation SHA and evidence manifest are in `D:\Downloads\evolution-os-smoke-temp\text-boundaries-development-handoff.json`.

## Main-flow fixes

Default UTF-8 reads removed a valid leading BOM. Exact parent/frozen/rendered roundtrips now keep that BOM, CRLF and Unicode while rejecting malformed encoding and byte drift. JSON syntax validation strips a BOM only from its validation view. See [UTF-8 handoff](artifact-utf8-handoff.md).

Separately, the AI output name could say `candidate.zip` while its stored bytes and Runner execution remained HTML. Snapshot/receipt mutual name agreement did not prove original format. Core now checks original text format in frozen-set identity, settlement and delivery; Server passes Source identity in construction, Experiment, current-version evidence, same-Hidden binding, Gate F and frozen file verification. Invalid names are rejected before freeze and use the existing one-attempt text-format recovery. Same-format rename, filename case and HTML/HTM aliases remain valid. Accepted files are not renamed or rebuilt. ZIP/Office materialization rules remain unchanged.

## Evidence and limits

Evidence directory: `D:\Downloads\evolution-os-smoke-temp`.

- BOM: 18 related suites / 219 tests, architecture, full lint, production build, 11 Runner tests and compiled readonly UI passed. Final fixture type fixes were rerun (20 passed and focused lint passed).
- Format reproducer against the unchanged BOM parent: `text-format-before-tests.log`, 11 failures / 61 passed. Failures include jointly wrong Snapshot/receipt format, actual accepted package/download entry and construction recovery.
- Combined focused verification: `text-boundaries-focused-tests.log`, seven suites / 93 passed, including both new boundaries.
- Final combined regression: `text-boundaries-final-tests.json` and `.log`, 28 files / 326 passed, zero failed. Architecture, full lint and TypeScript/production build passed; Runner/compiled readonly UI and final hashes are in the development handoff receipt.

The reproducer and physical package/download tests use synthetic fixtures and injected local ports. Neither regression counts, native HTTP receipts nor readonly UI prove the real Mission has a fresh Baseline, changed Candidate, paired same-Hidden execution, Gate F acceptance or identical downloaded/reopened accepted bytes. Mission `project-1790480873333` remains pending those receipts.

Main production was read before/after BOM UI checks on exact e3482e75 with no writes. These checks prove only that deployed SHA. New hosted CI and production remain UNVERIFIED while GitHub Actions account billing/allowance is blocked; Git/CI own the independent integration gates. User-selected custom model/key, operator/Vault and original/Candidate cloud export setup stay deferred. No root main push, deployment, secret/config update, real business Workflow or mutating production Cron occurred.