# ADR-0001 · V1 Stack and Package Boundaries

**Date:** 2026-09-18  
**Status:** Accepted

## Context

Evolution OS has reached a backend-ready stage. The existing React/Vite prototype contains mature Evolution Domain, Harness, evidence, parser and target-runtime logic, but `src/features/evolve/runtime` accumulated domain, orchestration, storage and infrastructure concerns. Backend integration must not duplicate or fork these rules.

The product priority is fastest usable production deployment, fast iteration and low maintenance, while preserving an exit path to more dedicated infrastructure later.

## Decision

### V1 platform
- React 19 + TypeScript + Vite for the control UI.
- Vercel for deployment, Functions, durable Workflows and isolated Sandbox execution; the Vite application uses Nitro only as the thin server/API integration required by the Workflow SDK and Vercel-compatible routes.
- Supabase for PostgreSQL, Storage and Realtime. Auth is deferred.
- Existing provider-agnostic AI Router remains.
- Python is optional for specialized parser/OCR workers only.

Do not introduce Redis/BullMQ/Kubernetes/a permanent Docker host/MinIO/a separate Fastify server in V1 without measured need.

### Code boundaries
- `@evolution/contracts`: Zod schemas, DTOs, versions and port interfaces.
- `@evolution/core`: pure Evolution Domain — what should happen.
- `@evolution/harness`: execution kernel — how it runs.
- `@evolution/adapters`: external-system implementations.
- `apps/*`: composition roots and user-facing/runtime hosts.

Dependency direction is inward. Concrete infrastructure must not leak into Core/Harness.

### Migration
Migration is incremental. The root Vite app and `runner-gateway` remain operational until package extraction is proven by build/tests. Compatibility shims may temporarily preserve old import paths but must contain no new business logic.

## Consequences

Positive:
- shared contracts between browser/workflow/backend;
- Vercel/Supabase can be replaced later behind Ports;
- Domain and Harness tests do not require production infrastructure;
- reduced long-term coupling and migration risk.

Trade-offs:
- temporary compatibility shims;
- root UI remains transitional until package extraction stabilizes;
- the legacy aggregate Evolve schema remains large and should be decomposed incrementally, not in one risky change.

## Enforcement

`PROJECT_RULES.md` is canonical. ESLint package-boundary checks and `pnpm architecture:check` enforce the most important dependency rules.
