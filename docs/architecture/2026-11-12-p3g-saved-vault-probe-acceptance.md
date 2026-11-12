# P3-G · Saved Lab Vault connection verification and bounded probes

Date: 2026-11-12
Workspace: `D:\Downloads\evlove-studio-evolve-p0`
Branch: `codex/artifact-evolution-governance-p0`
Lab Vercel Project: `prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs`
Lab Supabase: `jnlbqgpezenmpksyklme`
Production Supabase (read-only identity comparison): `mlvevgdntlswxbyxmlum`

## 1. Verified persisted roles

A metadata-only read of the isolated Lab `evolution_vault_secrets` records confirms two separate AES-256-GCM encrypted role bindings:
- `server-ai-default-connection-v1` / `ai:default-connection` / revision 2
- `server-ai-judge-connection-v1` / `ai:judge-connection` / revision 2

Both use Lab-specific key ID `lab-p3e-vault-01`. The database contents were not decrypted; ciphertext, IV, auth tags and API keys were not fetched or printed. Roles being saved does **not** demonstrate model reachability or that Judge uses a different provider/model identity.

The browser currently contains one MiniMax BYOK connection and a routing warning that Evaluator and Generator may be the same. Lab's separate Vault roles are independent storage locations; **independence of scoring models must still be verified with a real call and model fingerprints**.

## 2. Changes in this independent feature branch

- `apps/backend/src/services/server-ai-connection.ts`: `withServerAiJudgeProbe` pins the separately stored Judge as the sole temporary probe model; missing Judge must not fall back to generation.
- `apps/backend/src/services/server-ai-health.ts`: independent Judge health probe, no-generation fallback and role-partitioned 60-second in-process response caches.
- `apps/backend/server/api/evolution/ai-health.get.ts`: `?role=generation|judge` under mandatory `ai.execute` permission, no browser key submission.
- `apps/backend/src/services/server-ai-lab-probe.ts`: Lab-only `AsyncLocalStorage` fence permits at most one physical provider request per explicitly authorized **health probe**; output cap 2048 tokens. No active probe context means no Lab provider request.
- `apps/backend/src/services/server-ai-usage.ts`: checks budget context before each physical direct-provider attempt and SDK invocation. New attempts are refused before network transmission when the Lab scope is absent or exhausted.
- `apps/backend/src/services/ai-gateway.ts`: applies the Lab health-probe output cap to Responses, chat-completions and SDK; SDK retry set to zero for isolated Lab.
- `apps/backend/server/api/evolution/ai-connection-test.post.ts` and `capabilities.get.ts`: only authorized requests can enter the bounded probe context.
- `src/features/evolve/ai/server-connection-client.ts` and `settings-panel.tsx`: authenticated one-click buttons verify the **already saved** generation and Judge roles without sending a frontend API key; report separate public model IDs and readiness.

## 3. Evidence

- Full TypeScript `tsc -b`: PASS.
- Full ESLint: PASS, zero warnings.
- P3 suite: **22 files, 376 tests PASS, 0 failures**, including direct physical call rejection and Judge isolation.
- Vite/Nitro local build: PASS, 4,720 client modules and 86 workflow steps/2 workflows. Existing non-fatal `@vercel/sandbox` source-map warnings remain.
- Headless Chromium isolated local test: both buttons rendered; zero JS page errors; external network blocked; no production keys provided. Evidence screenshot: `artifacts/validation/p3g-local-dual-vault-probes-20261112.png`.
- No real provider API calls or Lab mission writes were made in this development validation.

## 4. Crucial limits

**The single-probe scope is not an aggregate cost budget.** It applies only to one HTTP request's asynchronous context; retries across separate invocations, Vercel instances and cold starts are not durably counted. Provider usage/price may be unknown. The `EVOLUTION_EXPERIMENT_MAX_CALLS=6` and `EVOLUTION_EXPERIMENT_MAX_COST_USD=5` environment values alone do not enforce limits.

Therefore, all Lab model traffic **outside the narrowly authorized health-probe contexts remains blocked** (`LAB_DURABLE_AI_BUDGET_REQUIRED`). A three-generation HTML Mission must not be called until a durable, transactional, cross-instance reservation ledger plus provider-usage/cost policy and cancellation have been implemented and tested. Never claim the 3-generation experiment passed from these health probes.

## 5. Operator steps after the new Preview is READY

1. Open the exact new Lab Preview deployment URL in the browser; complete Vercel SSO and Lab operator-session login if required. Cookies are deployment-host scoped.
2. Navigate to **AI 模型与连接 → 连接与模型 → 已保存后端模型 · 真实连通性验证**.
3. Click **验证已保存生成模型** once and record whether `runtimeVerified=true`, `ready=true`, model ID and message.
4. Click **验证已保存独立 Judge** once and record the same fields.
5. Compare both provider routes; if models are the same, independent *Vault roles* do not ensure fully independent judgment. Do not claim independent evaluation until different model/provider routes and holdout separation are validated.
6. Never paste API Keys, Vault keys, access keys or operator-session cookies into ChatGPT. If status fails, report model name, code/status and sanitized message only.

No Git merge or Production Vercel deployment is permitted in this phase.
