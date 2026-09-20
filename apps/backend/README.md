# Backend App Target

V1 backend target: Vercel Functions + Vercel Workflows. The root Vite app uses Nitro as the thin API/server integration layer; business logic remains in packages/apps backend services and Workflow steps.

This app will compose:
- `@evolution/contracts`
- `@evolution/core`
- `@evolution/harness`
- `@evolution/adapters`

Planned responsibilities: Mission API, durable Evolution Workflow host, job/event writes, artifact signing, Sandbox orchestration. Business/domain logic must not be implemented directly in route files.
