# Data Plane request deadline — 2026-10-10

## Functional defect and repair

Runtime `fe1353bbd504d958b427d268c6a6b666b4799771` on `codex/ai-transport-recovery` closes an unbounded wait in database-backed Mission/Job/control operations. Previously `dataPlaneFetch` returned successful headers and callers waited indefinitely for the rest of the body. A hung connection or error body could also block the request before the existing bounded read retries ran.

One request budget now covers headers, read retry delays and complete body consumption. The default is 30 seconds. Optional `EVOLUTION_DATA_PLANE_TIMEOUT_MS` accepts integer values from 100 through 60000; missing, empty, nonfinite, fractional and out-of-range settings use the default. No new configuration is required.

The native request receives the budget's AbortSignal. A guarded streaming Response retains status, headers, URL, type and redirected metadata, including clones; bytes are neither buffered into a second full copy nor changed. Timeout/body socket loss/caller abort yield the existing sanitized Data Plane availability error. Body completion or cancellation clears its timer and caller listener. Deadline expiry is reported as `rate-limited-or-timeout`; network/caller interruption remains `network-error`.

Read-only recovery retains the same URL, headers and request scope under one deadline and at most three attempts. Successful-header body failures are not replayed. POST/PUT/PATCH/DELETE are never automatically retried, including an incomplete 200 body. A write returning unavailable may already have persisted remotely; callers must retain their existing idempotency/CAS identity and inspect the authoritative receipt. The change does not assert rollback. Header-known credentials, missing-table and conflict failures keep their existing classification. No schema, grants, RLS, migration or production configuration changed.

## Actual failing and passing evidence

Seven actual localhost HTTP fixtures on the preceding source produced **six failures and one pass**: missing headers, unfinished 200/error bodies, post-header socket loss, final body after a read retry and caller cancellation. They carry only generated fixture text. Initial failure receipts remain `data-plane-deadline-before.json` and `.log` under `D:/Downloads/evolution-os-smoke-temp`.

Final regression: **18 unique files, 181 passed, zero failed/skipped**, covering the HTTP transport, actual Mission/Job REST runtime composition, Vault, evidence, organization, Outcome, release approval and control Job identity. Actual multi-byte Response/clone readback preserves both copies exactly. Fake-clock cases cover configuration fallback, shared retry signal, cancellation, bodyless responses and cleanup.

Architecture check, full lint and TypeScript/production build exited zero. The first build failed on a nullable test signal; that fixture was corrected and all gates rerun. `data-plane-deadline-gates-initial.json` and `data-plane-deadline-build-initial.log` preserve the failure. Final receipts are `data-plane-deadline-focused-final.json`, its file manifest/log and `data-plane-deadline-final-gates.json`, with separate architecture/lint/build logs.

The actual SDK dispatches the compiled initializer against a private localhost database fixture that sends 200 headers and never ends JSON. Its single generated-Mission GET reaches `step_started` and then **step_retrying** after the configured deadline, rather than hanging. The only registered step is the initializer, attempt 1. All outbound traffic is restricted to the owned SDK endpoint and the generated-ID local fixture; the server, fixture and local World were closed. Receipt: `workflow-data-plane-deadline-sdk-wire-receipt.json`. This proves runtime composition, not user-Mission execution.

A separate guarded actual Supabase GET on the same compiled source had an unclassified transport failure and then a successful empty generated-Mission read within that initializer's first attempt. It terminally fails before any Job lookup/write because that Mission does not exist. Its original helper required exactly one GET and therefore exits 1 with its strict flag false; preserve `workflow-native-fe135-data-read-sdk-wire-receipt.json`. The separate data-plane-deadline-runtime-root-audit.json records the observed bounded read recovery without rewriting the original result or claiming its network cause. No production records or user files were read/written in this generated-ID query.

## Integration and remaining acceptance

Cherry-pick this runtime and its documentation increment onto exact integrated `f8ffe821099d7d84390edd2915501e34540fd579`; the preceding Root increments are already integrated there. Three source files changed: `data-plane-http.ts`, its unit tests and new `data-plane-transport.test.ts`. Complete independent CI must cover the new integrated SHA. The preceding 334-file/2747-pass f8ffe receipt excludes this change.

At 2026-10-10 12:47 UTC, public GET build-info still identifies production `e3482e75f1ae6b88d7756e5ee35cecb0cbfa80f9`, main/production. Passive readiness reports secure Data Plane configured and saved-model encryption/storage unavailable. Production release/configuration remains the dedicated chats' responsibility. Public GETs prove only that deployed SHA, not this increment; `data-plane-deadline-production-readonly-receipt.json` records the observation and its separately retained field-projection correction.

The two previously bound local control runs still have only persisted pending initializer/attempt-0 metadata; their actual liveness and cause remain unproven. This repair is **not** claimed to explain or fix those runs. No old Job was repaired, re-enqueued or cancelled. Fresh user-file cloud execution approval, new real Baseline/diagnosis, changed frozen Candidate execution, paired same-Hidden validation, Gate F and exact accepted download/reopen remain outstanding. Hosted release approval and hosted CI billing are separate remaining boundaries. No model request, user-file export, deployment, production secret mutation or mutating Cron was performed by this increment.
