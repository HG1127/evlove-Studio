# Backend Environment · V1

P0-1 uses Supabase as the production data foundation. Do **not** put a Supabase service-role key in any `VITE_*` variable.

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

Before entering public multi-user production, remove the temporary auth-free migration policies and add Auth/RLS. The current migration intentionally matches the decision to postpone login/RBAC for the internal MVP.
