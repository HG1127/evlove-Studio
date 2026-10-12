# Failed Workflow control retry handoff

## Verified development status — 2026-10-12

Branch: `codex/workflow-failed-control-retry`. This branch builds on Event scalar-readback commit `8957c5adb43b09ba7b0c7105b317d12a8de13e3d`, with backend retry, UI recovery and atomic control ownership integrated. The exact final commit and source hashes are recorded in the external JSON handoff after commit.

21 relevant test files / 337 tests passed, including UI polling, stable request identity, normal start, failed retry, old main-flow recovery, Experiment recovery, offline Artifact readback, metadata-only SDK reads, Mission ownership CAS and client mutation guards. Architecture check, full lint, TypeScript and production build passed. These are development checks; a new complete independent CI gate is required for this branch.

The public before/after production reads at 2026-10-12 11:09 UTC both identify `bd6264067196addefdbec388b54211cef4653545`, main/production. PR #8 deployed the scalar query fix; its source tree matches the independently tested `8957c5a` tree. The complete local gate for that earlier query commit passed 336 files / 2798 tests, Runner, Chromium E2E and UI smoke. That gate does not cover this new retry branch.

## Product behavior

- The governed normal `POST /api/evolution/start` now supports explicit `retry-failed-control`. It requires the latest prior Control Job and Run, a current Mission source version and a deterministic operation key.
- SDK status uses the public metadata-only `resolveData: "none"` path. Pending, running, missing, contradictory and unverifiable Runs cannot be presented as retry success. A completed Run keeps its lost-acknowledgement replay semantics.
- An actual failed/cancelled Run may receive a new Control Job and Run. The prior Job/Run and failure evidence are retained.
- The frontend exposes this explicit retry only after read-only status proves eligibility. It polls after each completed read, ignores stale responses, permits only one request and does not automatically start execution or fall back to browser-local Harness. A queued acknowledgement is not labelled running.

## Atomic control ownership

Ownership is an additive server-owned field in the existing versioned Mission JSONB. No schema migration or old Job repair is needed.

1. A CAS on the checked Mission envelope reserves a fixed operation, Job ID, original source fingerprint/version and request time.
2. Exactly one reserved-to-dispatching CAS winner may send SDK start.
3. The new Job and Run are bound, then the matching owner becomes bound. A matching scheduled receipt is settled in the same owner CAS.
4. A same-key acknowledgement can finish a known pending owner binding; a proven unsent reservation can resume its original fixed identity before or after Job creation.
5. A dispatched start with no known binding remains explicitly unknown. It never sends another SDK start merely because a response or Run ID is missing.
6. Ordinary new keys cannot disguise failed retries or replace an active/unknown owner. Explicit retries also require the authoritative owner Run to match the requested prior Run.
7. New Workflow Steps check owner and Job/Run identity before business execution. Mission writes independently read the current owner while retaining the original writer CAS revision. Legacy unreserved inputs remain compatible.
8. Generic Mission POST/PUT cannot inject, remove or replace ownership; unchanged ownership is carried by ordinary edits.

## Preserved failed attempts and evidence

All evidence is under `D:/Downloads/evolution-os-smoke-temp`.

| Receipt | Observed result |
| --- | --- |
| `workflow-owner-first-20261012.json` | 97 passed / 1 old route fixture missing jobs.list |
| `workflow-owner-second-20261012.json` | 117 passed / 1 transport fixture expected recovery after two separately injected failures |
| `workflow-owner-broad-20261012.json` | 333 passed / 4 older recovery fixtures missing the new CAS/list/SDK-state composition |
| `workflow-owner-compatibility-20261012.json` | 3 files / 60 passed after explicit fixture corrections |
| `workflow-owner-final-regression-20261012.json` | 21 unique files / 337 passed |
| `workflow-owner-first-typecheck-20261012.log` | 512 MiB heap exhausted; exit 134 retained |
| `workflow-owner-second-typecheck-20261012.log` | Narrow fixture campaign type rejected; exit 2 retained |
| `workflow-owner-final-typecheck-20261012.log` | Explicit EvolveProject fixture type; 1024 MiB heap; exit 0 |
| `workflow-owner-local-gates-20261012.json` | Architecture, full lint and production build exit 0 |
| `workflow-owner-production-readonly-20261012.json` | Three HTTP 200 reads; stable deployed bd6264; new branch not deployed |

The local gates used Node 24.14.1 and pinned pnpm 11.23.0, single-worker tests and D: temporary paths. Earlier tests and CI do not replace the new exact-commit complete gate.

## Real Mission remains unaccepted

Mission `project-1790480873333` still has the preserved failed attempt:

- prior key `autopilot:2026-10-10T01:52:28.059Z`;
- Job `workflow-control-069915b2-be33-414c-a93a-1d99a5862a4f`, persisted running;
- Run `wrun_01M4QK7AGE9V35FWRABM6T5W56`, actual SDK failed at Event readback;
- original Artifact SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`;
- frozen `cand-P1-001` SHA-256 `9a616d1a919e18f6f6e606cee02ca9f9617e680c2875bf888fca07f8e863f068`.

Production Operator/model storage and saved MiniMax native direct structured-output health have been restored under the three human approvals. No new real retry was started from this undeployed branch. Fresh execution, paired same-Hidden evidence, Gate F and exact accepted download/reopen are still required.

## Next delivery

The CI/CD chat must run the complete exact-commit Quality Gate. While hosted Actions remain unavailable because of billing, use the already approved complete local fallback. The Git chat owns branch push, PR, main merge and deployment after that gate. Root owns normal governed real-Mission continuation after the exact deployed SHA is verified.

Public readiness still reports unconfigured release, Git target, connector and target proxy services, plus the temporary protected-deployment access code. These passive observations are separate from restored Operator/model access. They are recorded for later configuration and do not prove that the local HTML artifact path is blocked.

Do not manually trigger mutating Cron, repair old Jobs, delete blobs or execute migrations. Do not infer real business acceptance from CI or passive readiness.
