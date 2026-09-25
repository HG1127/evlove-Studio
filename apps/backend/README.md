# Backend App Target

V1 backend target: Vercel Functions + Vercel Workflows. The root Vite app uses Nitro as the thin API/server integration layer; business logic remains in packages/apps backend services and Workflow steps.

This app will compose:
- `@evolution/contracts`
- `@evolution/core`
- `@evolution/harness`
- `@evolution/adapters`

Planned responsibilities: Mission API, durable Evolution Workflow host, job/event writes, artifact signing, Sandbox orchestration. Business/domain logic must not be implemented directly in route files.

Current release responsibilities are implemented through backend services rather than route files:
- Supabase Mission / Job / Event / Artifact persistence and Realtime projection;
- durable Evolution Workflow control;
- Vercel Sandbox Build/Test/Preview/Browser Steps;
- independent Release Target routing;
- Vercel Production health observation;
- fail-closed Vercel Preview Gate / Promote / Rollback provider.

On the current Vercel Hobby plan, the truthful production path is `Preview Gate → Promote → Production Health → Rollback`. The 5/20/50 Canary stages remain available only to providers that can actually supply progressive traffic evidence. Vercel write actions require an explicit server-side `VERCEL_RELEASE_TOKEN`; OIDC alone is intentionally insufficient.

## Artifact Validation API

`POST /api/evolution/artifacts/register` stores an Artifact and binds its Mission, optional Job, kind, content type, size, and server-computed SHA-256 in Supabase. Artifact IDs are immutable: reusing an ID with different bytes or another Mission/Job/kind is rejected.
The legacy JSON endpoint `POST /api/evolution/artifacts` delegates to the same registration path and accepts the same bounded request contract. `/api/evolution/harness-run` accepts a strict `missionId` and optional `jobId` request for context preparation.
The legacy JSON `GET /api/evolution/artifacts?id=...` returns only textual content. Binary clients use `GET /api/evolution/artifacts/:id` to preserve exact bytes.

`POST /api/evolution/validation` accepts a versioned Zod request:

```json
{
  "missionId": "mission-id",
  "artifactId": "artifact-id",
  "artifactSha256": "optional-exact-sha256",
  "checkpointId": "optional-checkpoint-id",
  "idempotencyKey": "client-retry-key",
  "checks": {
    "expectedSha256": "sha256-to-assert",
    "minBytes": 1,
    "maxBytes": 100000,
    "containsText": "required text"
  }
}
```

At least one supported executable check is required to produce `passed`; failed integrity or assertion checks produce `failed`. Missing checks, unbound legacy Artifacts, and unsupported text decoding produce `unverified`. Results include the exact stored Artifact SHA-256 and persist in append-only EvolutionEvents. `GET /api/evolution/validation/:id` reads that durable record. Repeating a POST with the same idempotency key and request returns the same record; using that key for a different request returns `409`.

If an unkeyed POST response is lost, `GET /api/evolution/validation?missionId=...&artifactId=...` scans up to 50 authoritative Events per page and returns matching durable Validation results. Pass `nextCursor` as `afterId` until a page scans zero Events; a page with no matches may still have a cursor. This read requires `data.read`. Once the Validation ID is found, `POST /api/evolution/validation/:id/evidence-reconcile` can complete its signed Event and Validation Evidence without rerunning the Artifact checks; it requires `mission.execute`. Prefer an idempotency key for new Validation requests.

If Event append returns an ambiguous error, the server reads back the exact Validation Event and completes its Event Evidence mirror when the record exists. Otherwise HTTP 503 includes `data.validationId`; check `GET /api/evolution/validation/:id` before retrying. An unkeyed request should not be blindly repeated while its original database commit may still be in flight.

Checkpoint validation takes `missionId`, `checkpointId`, `artifactId`, and a persisted `validationId`; the API checks all four bindings before writing acceptance/rejection evidence. A client-supplied `validationPassed` boolean is not accepted as validation evidence.

## Job, Checkpoint, and Harness lifecycle

`POST /api/evolution/jobs` accepts a caller supplied `idempotencyKey`, optional `missionId`, `type`, `label`, optional `priority`, `inputRef`, and `metadata`. The server assigns the Job id and initial `queued` state. The database returns the same Job on an identical retry and returns `409` if that key is reused with different creation data. Job creation and its `JobQueued` Event commit in one transaction.
Job creation metadata is limited to 32 KiB. JSON Artifact registration is limited to 5 MiB of UTF-8 content; larger binary Artifacts need the dedicated private Storage upload path.
The compatibility binary `PUT /api/evolution/artifacts/:id` is bounded to 20 MiB per request and validates its ID and content type before writing. Its storage object is retained when a metadata write fails so reconciliation can recover without deleting previously accepted bytes.

`POST /api/evolution/jobs/:id/transition` accepts `status` and optional `detail`. Queued Jobs can start, fail, or cancel; running Jobs can wait or finish; waiting Jobs can resume, fail, or cancel. A terminal Job cannot be reopened. The database checks generation and the previously observed state timestamp, then commits the state and Event together.
Workflow Job Store writes and generation bound cancellation also commit their state and authoritative Event in one database transaction.

`POST /api/evolution/checkpoints` accepts `missionId`, `round`, and `completedPhase`. It uses the Mission revision to prevent lost updates, and commits the checkpoint with its `CheckpointCreated` Event. The response includes the persisted `checkpointId` for validation; acceptance checks that this remains the current Mission checkpoint. Concurrent edits return `409`; an identical retry returns the stored checkpoint.

`POST /api/evolution/harness-execute` is a compatibility entry point for the durable Mission Workflow started by `/api/evolution/start`. It returns `controlJobId` and `runId`; it no longer reports a request scoped `running` result. `/api/evolution/harness-run` remains a context preparation endpoint.

`POST /api/evolution/artifacts/reconcile` accepts `missionId` and `artifactId`. It re-reads durable Artifact metadata and bytes, checks Mission binding, SHA-256, and size, then idempotently completes the registration Event and Evidence writes. This recovers a registration whose blob upload succeeded but whose audit write failed.
The legacy `POST /api/evolution/evidence` accepts the same restricted request and cannot create a caller asserted validation result.

`POST /api/evolution/jobs/reconcile` inspects at most 100 aged, active Workflow Jobs. It accepts optional `missionId`, `minAgeSeconds` (default 600), `limit` (default 100), and `repair` (default false). It reports unbound or missing runs, terminal Workflow runs with nonterminal Jobs, and stale heartbeats. With `repair: true`, it closes Jobs whose run is unbound or confirmed missing, failed, or cancelled. A completed Mission Workflow can settle a running Job only when its persisted return value passes the Workflow result contract and matches the exact Mission and Control Job IDs. Missing, mismatched, or nonterminal results remain visible for investigation.
The scan validates each external Workflow run state and records `inspection-failed` when one run cannot be read; it continues with later Jobs and never repairs the unconfirmed item. Both scheduled preview and active Cron report these failures as HTTP 503 after their bounded scans, without logging upstream exception text.
Repair attempts carry the scanned Job generation, update timestamp, and run binding. A changed Job is rejected before the transactional transition; the database RPC also checks generation and prior update time. The report counts transitions that fail or return the wrong state as `repairFailures`, keeps scanning later Jobs, and does not expose upstream exception text. The active Cron returns HTTP 503 after its bounded Artifact scan when any repair fails.
The Job cancellation endpoint also preserves that distinction: if the Workflow has completed but its Job has not settled, it returns `409` with the unresolved Job and run instead of marking the Job successful.

Vercel Cron invokes `GET /api/evolution/jobs/reconcile-scheduled` daily at 18:00 UTC. It uses a bounded scan of 50 Jobs aged at least 15 minutes and repairs only the same confirmed failures as the operator endpoint. It also checks at most 50 aged Artifact tombstones and removes only orphan scratch blobs after verifying that no live Artifact metadata owns the path. Set a 16+ character `CRON_SECRET` in Vercel Production; the endpoint rejects missing configuration and requests without the matching bearer token. Cron activation requires a production deployment. Manual `vercel crons run` has the same production side effects as the scheduled invocation.

The daily `GET /api/evolution/data-plane-health-scheduled` and `GET /api/evolution/jobs/reconcile-preview-scheduled` routes use the same Cron secret but perform only reads. The preview runs Job reconciliation with `repair=false` and Artifact cleanup with `dryRun=true`; it is suitable for checking the maintenance data path before triggering the mutating route. The active Job scan queries each nonterminal status with a bounded result limit to avoid an unsupported combined filter in the deployed data plane.

V1 retention is conservative: EvolutionEvents, signed Evidence Ledger entries, and accepted Artifact bytes/metadata are retained without automated deletion so the exact accepted Artifact and its audit chain remain verifiable. The scheduled reconciler can remove orphan scratch blob bytes associated with durable deletion tombstones; it does not delete Mission metadata or accepted Artifacts. A finite retention/archive policy requires an explicit architecture decision and an export/identity-preserving migration.
Explicit Artifact deletion refuses Mission-bound objects and objects referenced by immutable Evidence. Unbound scratch objects without Evidence references can still be removed by the compatibility API.

## Source Parse result identity

Newly completed Parse Jobs record the SHA-256 of their exact serialized result in Job metadata. Status and recovery reads verify that hash and the parsed Artifact's ID, name, MIME type, size, role, upload mode, and source Storage ref against the Job. A valid JSON blob with substituted bytes or another Artifact identity is reported as `resultIssue`, never as a ready Artifact. Repeating the original Parse upload reuses a completed Job only when its result passes these checks; an invalid or legacy result without a binding starts a new Job generation for recovery.
New Parse starts use a versioned Workflow input with an exact Job generation and raw input SHA-256. Each generation has separate raw-input and parsed-output Storage IDs, so a retry does not attempt to overwrite immutable Artifact bytes. The Workflow checks the current Job identity and raw bytes before parsing and again checks Job generation before writing or finalizing; a stale run cannot fail or complete a newer generation. Persisted legacy Workflow inputs remain readable through the older contract while their old Job refs still match.

## Git Webhook Mission Binding

GitHub webhooks are not trusted by HMAC + repository allowlist alone. Only the canonical accepted branch `evolve/<mission>/<candidate>` can be correlated to a Mission Event, and the server then reloads the Mission and requires the same connected repository, Gate F accepted Search Champion, and the already persisted Accepted Git writeback repository / branch / exact commit. `pull_request` events additionally bind to the persisted PR number when one exists. A same-name branch created outside the accepted writeback path is therefore not sufficient to create Mission audit events.

Mission-bound GitHub webhook persistence is fail-closed: missing Mission state, binding drift, commit/PR drift, or Event Store failure returns an error rather than `accepted=true`. The Event id is deterministic from the GitHub event name plus the signed raw payload, so duplicate deliveries of the same body are de-duplicated by the Event Store. Non-Evolution branches may still be acknowledged at the webhook endpoint, but they are never attached to a Mission. Custom manual branch names remain publishable through the explicit Git API, but automatic Mission webhook correlation is intentionally limited to canonical Evolution branches.

## Connector Candidate Isolation

`EVOLUTION_CONNECTORS_JSON` connectors must declare how `mutate` behaves. The safe default is `"mutationMode": "direct"`, which is read/snapshot capable but is **not** eligible for Candidate experiments even if `mutate` and `validate` endpoints exist. This prevents an experimental Candidate from silently mutating the live Agent / Workflow / SaaS object.

A Connector may participate in Candidate generation and validation only when it explicitly declares `"mutationMode": "staged-version"`. In that mode, `mutate` must create or update an isolated candidate version, return a new exact `versionRef` that differs from `expectedVersionRef`, and must not change the live production target. The server rejects a staged mutation that reuses the base version id. Production changes remain separate `deploy` / `observe` / `rollback` lifecycle operations.

Example:

```json
[
  {
    "id": "workflow-main",
    "label": "Workflow Main",
    "targetType": "workflow",
    "baseUrl": "https://connector.example.com",
    "mutationMode": "staged-version",
    "credentialEnv": "WORKFLOW_CONNECTOR_TOKEN",
    "paths": {
      "read": "/read",
      "snapshot": "/snapshot",
      "mutate": "/mutate",
      "validate": "/validate",
      "deploy": "/deploy",
      "observe": "/observe",
      "rollback": "/rollback"
    }
  }
]
```

The server re-checks this isolation declaration before Candidate mutation, so bypassing the browser capability filter does not enable direct mutation.

Connector webhooks use `x-evolution-connector-signature: sha256=<HMAC>` and are not trusted by signature alone. A webhook that names a `missionId` must also match that Mission's connected `connectorId`, `targetId`, and an exact currently bound `versionRef` (locked target snapshot, current Candidate, or Search Champion). Unknown/stale versions are rejected before Event persistence. Event persistence is fail-closed: storage failure returns an error instead of acknowledging success. Identical signed webhook retries derive the same deterministic Event id from the connector id plus raw request body, so the Event Store de-duplicates delivery retries.

Connector release reconciliation is also exact-bound. An `observe` response may not silently switch to another deployment or stable deployment: if the provider returns a `deploymentRef` / `stableDeploymentRef`, it must match the Mission deployment being reconciled. When the provider omits the deployment ref, the server preserves the explicit Mission ref rather than replacing it with a version id.

Release receipts must also be semantically self-consistent. `trafficPercent` must exactly match `effectiveAction` (Shadow/Rollback 0, Canary 5/20/50, Promote 100), `healthy` must agree with a terminal healthy/unhealthy observation status, and a `preview-promote` Connector may not report Canary traffic that the configured release mode cannot actually provide.

## Outcome Telemetry

Release reconciliation always records provider health/latency evidence when the secure Outcome Warehouse is available. External business KPI, cost, latency, and safety metrics can additionally be pulled server-side with `EVOLUTION_OUTCOME_TELEMETRY_JSON`. Credentials stay in server environment variables referenced by name; secrets are never embedded in the JSON.

Example:

```json
[
  {
    "id": "product-kpis",
    "urlTemplate": "https://metrics.example.com/release?deployment={deploymentId}&arm={arm}",
    "auth": {"type": "bearer", "env": "PRODUCT_METRICS_TOKEN"},
    "metrics": [
      {"metricKey": "conversion_rate", "metricKind": "business", "direction": "higher", "path": "metrics.conversionRate", "unit": "ratio"},
      {"metricKey": "cost_per_request", "metricKind": "cost", "direction": "lower", "path": "metrics.costPerRequest", "unit": "usd"}
    ]
  }
]
```

Supported URL tokens are `missionId`, `candidateId`, `deploymentId`, `deploymentUrl`, `arm`, `trafficPercent`, and `releaseStatus`. Telemetry failures are fail-soft for Release Health: they are surfaced as warnings and never turn missing business metrics into a fabricated PASS.

A telemetry source that requests both Stable and Candidate arms must include at least one real arm discriminator in its URL template: `{deploymentId}`, `{deploymentUrl}`, or `{arm}`. A global endpoint that cannot distinguish the two arms is rejected at configuration time instead of being requested twice and mislabeled as an A/B comparison.

Outcome Warehouse ingestion is Mission-bound. New samples are normalized to the current Release Candidate and must use the exact deployment bound to their declared Stable/Candidate arm; explicit Candidate drift, deployment drift, missing deployment identity, invalid timestamps, and timestamps more than two minutes in the future are rejected. The same binding is applied to automatic Release Telemetry before persistence. Outcome analysis defaults to the current Release Candidate when no Candidate is supplied, and the Core statistics layer filters cross-Candidate, invalid-time, and materially future samples so pre-existing bad rows cannot influence the verdict.

For a given `metricKey`, Stable and Candidate samples must also share one measurement contract: the same `metricKind`, optimization `direction`, `unit`, and `source`. Conflicting contracts are rejected during batch ingestion and re-checked before analysis so historical rows measured in different units or by different telemetry sources cannot be merged into a false comparison.
