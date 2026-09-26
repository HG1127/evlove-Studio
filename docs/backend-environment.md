# Backend Environment · V1

The Vercel API owns production data access. Keep Supabase server credentials, actor signing material, and the browser operator key in server-only environment variables. Never put them in `VITE_*` variables or commit them to Git.

## Production data plane

Configure `SUPABASE_URL` and the full `SUPABASE_SECRET_KEY` in Vercel Production. `SUPABASE_SERVICE_ROLE_KEY` remains a compatibility fallback. The server accepts a publishable key only in nonproduction or when `EVOLUTION_ALLOW_PUBLISHABLE_DATA_PLANE` is explicitly enabled; this is not the production security posture. `VITE_SUPABASE_ARTIFACT_BUCKET` selects the private Artifact bucket (default `evolution-artifacts`).

The production browser uses the same-origin `/api/evolution/*` API and does not need a Supabase secret. The browser can explicitly select local mode if the backend is unavailable; data created there stays in that browser until a later authenticated sync.

## Single-operator browser access

The initial production UI uses a single-operator access key. Set these server-only Vercel Production variables:

```text
EVOLUTION_WORKSPACE_ID=<the configured production workspace ID>
EVOLUTION_IDENTITY_HMAC_SECRET=<at least 32 random characters; preserve the existing value if configured>
EVOLUTION_OPERATOR_ACCESS_KEY=<64 random hexadecimal characters, generated independently of the signing secret>
```

Generate the access key locally with PowerShell, then copy it directly to the Vercel Production variable. Do not paste it into a chat or repository file:

```powershell
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLowerInvariant()
```

Redeploy after changing the variables. Open the production alias and enter the access key in the browser's “连接工作区” form. The server exchanges it for a signed, HttpOnly, Secure, SameSite=Strict cookie lasting eight hours. The key is not stored in browser storage. The operator session is scoped to `EVOLUTION_WORKSPACE_ID`; rotating either the access key or signing secret invalidates existing sessions. Logging out clears the current browser cookie. Browser writes require a same-origin request.

This is for a trusted single administrator on one workspace. The access key grants the existing `admin` role, including release approval and security administration; handle it as a production root credential. Full multiuser identity, organization membership, per-user revocation, and RLS remain separate work. Keep the current exact-deployment internal bridge limited to protected deployment diagnostics and remove it when the browser actor flow is production-evidenced.

Verify deployment without exposing secrets:

1. `GET /api/evolution/operator-session` returns `{configured:true,authenticated:false}` in a fresh browser.
2. A wrong key returns 401; the correct key returns `{configured:true,authenticated:true}` with a protected cookie.
3. `GET /api/evolution/operator-session` then reports authenticated. The UI must show “后端同步正常” before treating browser data as synced.
4. `DELETE /api/evolution/operator-session` clears the cookie, and protected API reads again return 401.

## Vercel Release Provider

Production health observation does not require a Vercel API token. Vercel deployments also expose project identity and the production URL through system environment variables; local development may read the ignored `.vercel/project.json` created by `vercel link`.

Promote / Rollback are deliberately fail-closed unless a dedicated server-side credential is configured:

```text
VERCEL_RELEASE_TOKEN=<dedicated Vercel API token>
```

`VERCEL_OIDC_TOKEN` is **not** a substitute for this release credential: OIDC is used by Sandbox / Workflow, while Vercel Project and Deployment management APIs currently reject it. Never expose `VERCEL_RELEASE_TOKEN` through a `VITE_*` variable.

The current Vercel Hobby project uses **Preview Gate → Production Promote**. Rolling Release / 5% → 20% → 50% Canary is not supported by the plan and is explicitly skipped rather than simulated.
