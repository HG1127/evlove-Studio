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
