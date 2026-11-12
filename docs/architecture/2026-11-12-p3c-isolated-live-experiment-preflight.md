# P3-C · Isolated live evolution laboratory readiness

Date: 2026-11-12 (Asia/Singapore)

## Status

Static isolation preflight implemented and tested. **No live MiniMax evolution call and no test Mission writes performed.** This is a deliberate fail-closed status, not a simulated real-model success.

## Verified environment facts

- Independent Evolve Studio checkout: D:\\Downloads\\evlove-studio-evolve-p0, branch codex/artifact-evolution-governance-p0, based on 60608f7.
- Full TypeScript, full ESLint, architecture ESLint, Vite/Nitro build and 346 regression tests passed after frozen-lockfile pnpm installation, without changing dependency versions or lockfile.
- Isolated local Nitro server served the React app over loopback. Chromium loaded the model settings editor after explicit browser-only continuation; no production secrets were supplied and external browser network requests were blocked.
- The local Runner does not have docker, supabase CLI or psql available; no local docker-compose or supabase/config.toml found.
- Read-only Vercel project environment metadata inspection (decrypt=false) showed SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY targeted at both production and preview. SUPABASE_SECRET_KEY, Vault master key and operator access key are production-targeted. These facts do not prove a separate preview database and must not be interpreted as permission to reuse production data.
- The ChatGPT Supabase integration was offered and subsequently appears installed, but no Supabase project administration tool was available to this execution session. No database resource was created or mutated.

## New reusable isolation preflight

- scripts/p3c-isolated-lab-preflight.mjs
- scripts/p3c-isolated-lab-preflight.test.mjs

The preflight checks:
- Explicit isolated mode and never a production deployment.
- Different declared production and test Supabase project identities, including matching the URL's project reference.
- A dedicated experiment service credential (presence only) and evolve-audit-* artifact bucket.
- Maximum six generation/repair calls, three generations, 12,000 output tokens per call and USD 5 total experiment budget.
- Never serializes credentials or complete data-plane URLs.
- Returns liveCallAllowed=false **even when all static checks pass**. Runtime identity, separate database/bucket access, encrypted model connection, independently governed Judge, provider spend enforcement, timeout/cancellation and disposable Mission authorization must be checked elsewhere before any real API operation.

Unit tests: **9 passed, 0 failed**. Running the preflight against the actual isolated Runner resulted in staticReady=false and liveCallAllowed=false, as expected.

## Exact next runtime sequence

1. Identify or create a disposable Supabase test project, separate from the production project (not merely a new bucket in production). Set a dedicated storage bucket and test-only admin identity.
2. Configure authorized server-side generation/Judge connections in that test environment via the existing encrypted Vault, without copying production secrets into source, logs or this report.
3. Ensure the provider-side spending cap and explicit call/output-token caps can actually stop requests.
4. Run the preflight. It should still not authorize live calls; add runtime checks for test Supabase identity, bucket rights, Judge/holdout separation, cancellation and audit Mission restrictions.
5. Run the existing Evolve Studio HTML mission workflow on synthetic data, max three generations; record model IDs, provider usage, SHA-256 of each generation and independent acceptance.
6. Independently verify no regression and no protected-file mutations. Do not deploy or promote any candidate unless ordinary Gate F passes.

## Protection

No production Mission, Vault or bucket was modified. No model API call was sent in P3-C. No code was committed, merged, pushed or remotely deployed. Main original checkout stays on codex/custom-backend-models at 60608f7, with 14 original untracked scripts preserved.
