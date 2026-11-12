# P3-F · Vercel Lab environment configuration and secure handoff

Date: 2026-11-12 (Asia/Singapore)

## 1. Dedicated Vercel project

- Project: `evlove-studio-evolution-lab`
- Project ID: `prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs`
- Team: `team_kK5GqMJNWpI0A7NmY6nnXgIQ`
- Framework: Nitro
- Node: 24.x
- Function region: Sydney
- SSO deployment protection: enabled for all deployments
- Preview deployments: enabled; all created preview deployments remain behind Vercel SSO
- Git repository: not linked yet
- Deployments: 0
- Environment variables: 25, **all target Preview only**; none target Production or Development.

The project was created separately; no existing production project settings or environment variables were changed.

## 2. Non-secret and generated encrypted variables

Configured on the new Vercel project, Preview target only:

- Experiment mode and target: `EVOLUTION_EXPERIMENT_MODE=isolated`, `EVOLUTION_EXPERIMENT_TARGET=preview`
- Lab project identity: `EVOLUTION_TEST_SUPABASE_PROJECT_REF=jnlbqgpezenmpksyklme`
- Production project identity for negative-match guard: `EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF=mlvevgdntlswxbyxmlum`
- Lab URL bound to server and Vite: `https://jnlbqgpezenmpksyklme.supabase.co`
- Dedicated artifact bucket: `evolve-audit-p3c-lab`
- Workspace: `lab-evolve-p3c-test`
- Vault key ID: `lab-p3e-vault-01`
- Evidence signing key ID: `lab-p3e-evidence-01`
- Independent cryptographic values generated with Node crypto and saved as encrypted Vercel environment variables: `EVOLUTION_IDENTITY_HMAC_SECRET`, `EVOLUTION_VAULT_MASTER_KEY`, `EVOLUTION_EVIDENCE_SIGNING_KEY`.
- Lab publishable key copied from the **Lab project only**, stored as encrypted `SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_ANON_KEY`.
- Insecure internal auth, protected-deployment auth bypass and publishable data-plane fallback are explicitly disabled.
- Static experiment caps: 6 model calls, 3 generations, 12,000 output tokens per call, USD 5 target cap.

No generated secret values or Supabase key values are included in this report.

## 3. Two remaining secrets — user enters directly in Vercel

The Vercel project environment currently has exactly 25 variables. These two are intentionally absent and must be entered directly in the Vercel dashboard. **Do not send either value in ChatGPT or put it in source control.**

Open Vercel → `evlove-studio-evolution-lab` → Settings → Environment Variables. Add both with **Preview** selected only and Sensitive/Encrypted storage:

### A. `SUPABASE_SECRET_KEY`

1. Open Supabase Dashboard and select `Evlove-Studio-Evolution-Lab` (project ref `jnlbqgpezenmpksyklme`).
2. Project Settings → API Keys → Secret keys.
3. Create a new Lab-only secret key (do not use the Production project's secret or legacy service_role key).
4. Paste it directly into the new Vercel project's `SUPABASE_SECRET_KEY`, Preview only, Sensitive/Encrypted.

The browser publishable key already configured is not a substitute for this server-side secret.

### B. `EVOLUTION_OPERATOR_ACCESS_KEY`

Generate a unique 32-byte value locally in PowerShell (64 lowercase hex characters):

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
```

Add the output directly to the new Vercel project as `EVOLUTION_OPERATOR_ACCESS_KEY`, Preview only, Sensitive/Encrypted. Keep the value in the user's password manager. The backend operator-session contract requires exactly 64 hexadecimal characters.

After both variables are saved, redeploy the Preview deployment so the runtime receives them. Never set either variable on the existing `500ipo-evolve-studio` project or Production target.

## 4. Remaining release wiring

- The new Vercel project is not yet linked to Git; no deployment exists.
- The isolated development branch contains uncommitted P0–P3 work. It must be published to a dedicated remote feature branch before Vercel can build that exact code. Do not deploy the repository's production branch as a substitute.
- Once the remote feature branch is available, connect `HG1127/evlove-Studio` to this Vercel project, set the project root to repository root, build with the repository's `pnpm@11.23.0` package manager and `pnpm build`; Vite sets Nitro preset to `vercel` automatically when `VERCEL=1`.
- Deploy as a **Preview** only, preserve SSO protection, and verify that the deployment has no production aliases.
- Configure MiniMax generation and independent Judge inside the Lab deployment's own encrypted Vault. Do not copy or attempt to decrypt the Production Vault.

## 5. Current status

- 25/25 non-secret/generated-preview environment entries present and metadata verified with `decrypt=false`.
- 5 values stored as encrypted entries: three generated Lab secrets plus two Lab publishable-key entries.
- `SUPABASE_SECRET_KEY`: pending user entry.
- `EVOLUTION_OPERATOR_ACCESS_KEY`: pending user entry.
- No Git link and no deployment.
- No model API call, no Mission write and no production database/Vault change.

## 6. Code and configuration guard verification (2026-11-12)

- The runtime isolation guard now also requires a 64-hex-character Lab operator access key and a dedicated Lab evidence signing key/key ID; it fails closed if either is absent.
- The standalone preflight checks the same two requirements. No secret values are printed.
- Static preflight tests: 11 passed, 0 failed.
- P3 regression suite: 20 files, 358 tests passed, 0 failed.
- Full TypeScript project build: passed.
- Full ESLint: passed with zero warnings.
- Vite/Nitro build after the guard changes: passed, exit code 0. Existing non-fatal missing source-map warnings from @vercel/sandbox and stale Browserslist data remain.
- No live MiniMax call, Mission write or deployment was performed.

## 6. Required follow-up verification

After the two manual secrets are entered and code is deployed to Preview:
1. Check the Lab project identity, server credential mode `secret`, dedicated Bucket and workspace.
2. Confirm operator login works using the Lab-only access key.
3. Verify the encrypted Lab Vault can store and read back a MiniMax generation connection without returning its API key.
4. Configure and independently test the Judge connection.
5. Confirm provider-side spend limits and actual runtime call/token/cost enforcement before any three-generation mission.
