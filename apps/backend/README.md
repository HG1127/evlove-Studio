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
