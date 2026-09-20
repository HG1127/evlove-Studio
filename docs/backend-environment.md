# Backend Environment · V1

P0-1 uses Supabase as the production data foundation. Do **not** put a Supabase service-role key in any `VITE_*` variable.

Evolution OS also deliberately ignores `SUPABASE_SERVICE_ROLE_KEY` in its current server data plane. Server reads use `SUPABASE_PUBLISHABLE_KEY` (or the internal-MVP `VITE_SUPABASE_ANON_KEY`) so a leftover service-role variable cannot silently bypass future RLS.

Configure the Vite/Vercel environment with:

```text
VITE_SUPABASE_URL=<your Supabase project URL>
VITE_SUPABASE_ANON_KEY=<your publishable/anon key>
VITE_SUPABASE_ARTIFACT_BUCKET=evolution-artifacts
```

Optional future API gateway:

```text
VITE_EVOLUTION_API_URL=<Vercel API base URL>
```

When `VITE_EVOLUTION_API_URL` is configured it takes precedence over direct Supabase ports. Without either backend configuration the product stays on Local Adapter.

## Vercel Release Provider

Production health observation does not require a Vercel API token. Vercel deployments also expose project identity and the production URL through system environment variables; local development may read the ignored `.vercel/project.json` created by `vercel link`.

Promote / Rollback are deliberately fail-closed unless a dedicated server-side credential is configured:

```text
VERCEL_RELEASE_TOKEN=<dedicated Vercel API token>
```

`VERCEL_OIDC_TOKEN` is **not** a substitute for this release credential: OIDC is used by Sandbox / Workflow, while Vercel Project and Deployment management APIs currently reject it. Never expose `VERCEL_RELEASE_TOKEN` through a `VITE_*` variable.

The current Vercel Hobby project uses **Preview Gate → Production Promote**. Rolling Release / 5% → 20% → 50% Canary is not supported by the plan and is explicitly skipped rather than simulated.

Before entering public multi-user production, remove the temporary auth-free migration policies and add Auth/RLS. The current migration intentionally matches the decision to postpone login/RBAC for the internal MVP.
