# Evolution OS Engineering Rules · V1

> **Status: mandatory.** This is the canonical engineering baseline for this repository and for new Evolution OS projects derived from it. New code MUST follow these rules unless an explicit architecture decision record (ADR) documents and approves an exception.

## 1. Product and architecture objective

The product is an evidence-driven Evolution OS. Its invariant flow is:

`real input → goal/contract → baseline → diagnosis → candidate mutation → experiment → holdout → artifact acceptance → deliver/deploy the same tested artifact → outcome → learning → next queue`.

A feature is incomplete if it skips evidence, changes the artifact after validation, or cannot identify the exact state/job/event/artifact involved.

## 2. Frozen V1 technology stack

### Product UI
- React 19
- TypeScript
- Vite
- React Router
- Tailwind CSS + Radix UI + Lucide
- Zod for all cross-boundary schemas
- Vitest for unit/contract tests
- Playwright for browser/E2E evidence

### Production platform
- **Vercel**: Web deployment, Functions, durable Workflows, Sandbox. For the current Vite app, **Nitro is the thin server/API integration layer** used to expose Vercel-compatible routes and Workflow SDK endpoints; it is not a separate application server.
- **Supabase**: PostgreSQL, Storage, Realtime; Auth may be added later
- Existing provider-agnostic AI Router remains the model abstraction
- Python is optional and only for specialized parser/OCR workers (Docling/OCR/complex layout), not the main control plane

### Explicit V1 non-goals
Do not add Redis, BullMQ, Kubernetes, a permanent Docker host, MinIO, a separate Fastify server, or a Python main backend unless measured product/runtime needs justify them. Vercel Workflow/Sandbox + Supabase are the default V1 infrastructure.

## 3. Canonical repository structure

```text
apps/
  web/                 # React control UI (root app is transitional during migration)
  backend/             # Vercel Functions + Workflows

packages/
  contracts/           # Zod schemas, DTOs, versioned contracts, ports
  core/                # pure Evolution Domain: what should happen
  harness/             # execution mechanics: how it runs
  adapters/            # Supabase/Vercel/AI/HTTP/local/browser implementations
  ui/                  # reusable generic UI only
  testkit/             # fixtures, memory ports, mocks

supabase/
  migrations/
  seed.sql

tools/
  local-runner/        # local-only browser/build runner after migration

docs/
scripts/
```

The current root React app and `runner-gateway/` are transitional. Do not move hundreds of files in one change. New architecture work must use the target directories, and existing code is migrated in small build-tested steps.

## 4. Layer responsibilities

### contracts = shared language
Allowed: Zod, TypeScript types, DTOs, schema versions, port interfaces.
Forbidden: React, Supabase SDK, Vercel SDK, localStorage, IndexedDB, fetch, browser globals, business orchestration.

### core = Evolution Domain / WHAT
Examples: workflow state, goal readiness, diagnosis, search, candidate fitness, acceptance, learning.
Core must be deterministic/pure where possible.
Forbidden: React, Supabase, Vercel, HTTP, localStorage, IndexedDB, UI state.

### harness = execution kernel / HOW
Owns planner loop, context/budget, tool contract/router, policy, failure routing, checkpoint semantics and action execution contracts.
Harness may depend on contracts/core.
Harness MUST NOT depend on React or concrete Supabase/Vercel implementations. External I/O enters through injected ports/tools.

### adapters = external world
Owns Supabase, Vercel Workflow/Sandbox, HTTP, AI provider clients, local/IndexedDB compatibility, Playwright and target implementations.
Adapters implement interfaces declared by contracts/core/harness.
Adapters may depend inward; inward layers may not depend on adapters.

### apps = composition roots
Apps choose concrete adapters, wire dependencies, expose routes/UI/workflows, and contain environment-specific bootstrap code.
Apps may depend on packages; packages must never import apps.

## 5. Mandatory dependency direction

Preferred direction:

`contracts ← core ← harness ← apps`

`contracts/core/harness ← adapters ← apps`

Hard prohibitions:
- contracts → core/harness/adapters/apps
- core → harness/adapters/apps
- harness → adapters/apps
- packages → `apps/web` or React page code
- deep relative imports crossing package boundaries

Cross-package imports MUST use `@evolution/*` package aliases/public exports.

## 6. Domain naming rules

Use one canonical name per concept:
- **Mission**: domain execution unit. UI may say “项目”.
- **EvolutionJob**: every asynchronous/background unit. Difference belongs in `job.type`.
- **EvolutionEvent**: authoritative state-change event. UI “activity/history” is a projection, not another source of truth.
- **Artifact**: source or evolved file/object with identity/hash.
- **Candidate**: concrete evolved proposal/snapshot, never only prose.
- **Evidence**: verifiable observation bound to test/artifact/version.
- **Checkpoint**: resumable execution boundary.

Do not create parallel synonyms such as ParseTask/EvidenceTask/BackgroundTask when `EvolutionJob` covers the concept.

## 7. Data and side-effect rules

- UI components must not directly call Supabase tables or mutate production state.
- UI → hook/service → port/API.
- Core/Harness must not call `localStorage`, IndexedDB, fetch, Supabase or Vercel directly.
- Supabase is the V1 system of record for production Mission/Job/Event metadata.
- Supabase Storage is the V1 Artifact blob store.
- LocalStorage/IndexedDB are local adapter/cache/prototype compatibility only.
- Durable background execution belongs in Vercel Workflows, not React effects.
- Untrusted code execution belongs in Vercel Sandbox/isolated runner, not the host process.

## 8. Contract and schema rules

Every external/storage/AI boundary is Zod-validated.
Versioned contracts must keep explicit versions such as:
- `mission-v1`
- `job-v1`
- `event-v1`
- `target-v1`
- `artifact-v1`
- `evidence-v1`
- `harness-v1`

Breaking contract changes require a new version or migration. Never silently reinterpret stored production data.

## 9. Evolution invariants

- Test the exact Candidate Artifact that may be delivered.
- Do not regenerate a different deliverable after acceptance.
- VERIFIED/PARTIAL/UNVERIFIED/FAILED must remain truthful.
- Missing capability is not product failure and must not be fabricated as PASS/FAIL.
- Candidate generation and independent evaluation remain separable.
- Production promotion requires production evidence; simulation cannot satisfy an online gate.
- Every retryable action must have an idempotency key/generation boundary.

## 10. Files and module size

- Do not add new “god folders” or “god files”.
- New runtime files must be placed by responsibility, not dumped into `runtime/`.
- A file approaching ~400–500 LOC should trigger a responsibility review.
- React pages compose features; business algorithms do not live in pages/components.
- Generic UI primitives contain no Evolution policy/orchestration.

## 11. Testing requirements

Every migrated/extracted package must keep or add tests before deleting compatibility paths.
Required before merge/release:
- TypeScript production build
- focused unit/contract tests
- lint on changed architecture files
- Runner tests when runner/build/release changes
- browser/E2E evidence for UI/runtime behavior when applicable

Tests should colocate with the implementation; shared fixtures belong in `@evolution/testkit`.

## 12. Database rules

V1 uses Supabase PostgreSQL.
Start with a small durable model: `missions`, `jobs`, `events`, artifact metadata/storage. Keep complex Mission state in versioned JSONB initially; split tables only when real query/scale needs emerge.
All schema changes must be migrations in `supabase/migrations`; never rely on manual dashboard-only production changes.

## 13. Migration policy for this repository

Migration is incremental and must preserve a working build.

Phase 1 (current): establish workspace/packages; move shared contracts; extract pure Harness utilities; extract production HTTP adapter; retain compatibility re-exports.
Phase 2: move remaining pure Domain modules from `src/features/evolve/runtime` into `packages/core`.
Phase 3: make Harness fully dependency-injected and move planner/action executor/context/policy/checkpoint into `packages/harness`.
Phase 4: move local/Supabase/Vercel/Target implementations into `packages/adapters`.
Phase 5: move root React app into `apps/web`; move local runner into `tools/local-runner`.
Phase 6: add `apps/backend` Vercel Functions/Workflows and Supabase migrations.

Do not combine multiple high-risk phases into one refactor.

## 14. Enforcement

New code that violates dependency direction is considered architecture debt and should not be accepted silently.
When a temporary compatibility shim is necessary:
1. mark it as a compatibility shim;
2. keep the implementation in the correct package;
3. do not add new business logic to the shim;
4. remove it in the planned migration phase.

Architecture decisions that intentionally diverge from this document require a dated ADR under `docs/architecture/`.
