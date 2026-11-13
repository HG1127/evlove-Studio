# P3-J · Lab Workflow admission, 20-minute control and safe budget settlement

Date: 2026-11-12
Workspace: `D:\Downloads\evlove-studio-evolve-p0`Branch: `codex/artifact-evolution-governance-p0`
Base HEAD: `2ce15c2`

## 1. Scope / security boundary

This phase makes the isolated Lab Workflow eligible for *future* authorized synthetic experiments only. It does **not** run a live MiniMax request or arm any provider budget. Production/original worktrees remain unchanged, and no code was pushed, committed, merged or newly deployed by this phase.

- The independent Lab project at Supabase ref `jnlbqgpezenmpksyklme` has 26 previous migrations, including P3-H/P3-I atomic budget and single-flight guards.
- Latest Vercel Lab SSO-protected Preview was READY at Git commit `2ce15c2`, which predates P3-H/P3-I/P3-J uncommitted changes. Do not use its healthy state as proof the latest source has been deployed.
- The Lab Vercel environment inventory (metadata only, `decrypt=false`) contains a configured operator credential but **does not contain** `EVOLUTION_LAB_EXPERIMENT_ARMED`, `EVOLUTION_LAB_APPROVED_MISSION_ID` or `EVOLUTION_LAB_AI_PRICING_POLICY_JSON`.
- Existing Lab Vault contains separate saved generation/Judge **roles**. Neither role's API Key was requested, copied, printed, re-saved or decrypted for this phase.

## 2. P3-J implementation in the independent worktree

1. Added a strict, versioned `LabWorkflowPermitSchema` in `packages/contracts/src/workflow-contract.ts` with exact Mission/actor/time and hard six-attempt / USD 5 bounds. Existing non-Lab contracts remain compatible.
2. Added `lab-workflow-permit.ts`: isolated-mode, `security.admin`-mediated, server-only explicit Mission allowlist; a one-shot 20-minute deadline; immutable permit comparison against the stored Campaign Job. A forged/missing/expired/cross-Mission permit fails before execution.
3. Added `lab-workflow-admission.ts`: permits only explicit authorized one-time synthetic HTML Mission start; reads public model settings for generation and Judge from the **existing** encrypted Vault; rejects an identical evaluator route; requires both routes in a time-limited, server-reviewed price/spend policy before approval. Model role existence alone is not independent *judgment* proof.
4. Wired `apps/backend/server/api/evolution/start.post.ts` so Lab starts require both `mission.execute` and `security.admin`. The exact server-issued permit is attached to both Workflow input and the persisted Job metadata. After atomic Job creation, the existing `initializeLabAiBudget` RPC must succeed **before** Workflow starts. A missing/failed receipt leaves the Job inert/failed. Same-request replay must match the existing Job permit. Failed Workflow startup attempts to cancel the enrolled Lab budget.
5. Wired `initializeWorkflowControlStep` to recheck the same stored permit/Job identity and idempotently verify budget enrollment before JobStarted. Rejected permits and inaccessible Lab budget fail closed.
6. Extended `withServerControlExecution` to verify the persisted permit at each Job read and abort its active HTTP signal when the 20-minute deadline is reached. Additional Job cancellation and the existing P3-I database deadline guard stop subsequent requests.
7. Added Budget cancellation on one-shot Workflow finalization, failure and limit stops, and explicit cancellation in `job-workflow-cancel.ts`. Unknown cancellation/settlement does not report a completed success.

## 3. Evidence and test scope

- Focused P3-J mocked tests cover server-issued permit, authorization, Vault role distinction, missing pricing, Step-0 budget first, cancellation, persistent metadata mismatch and a 20-minute fake-timer abort.
- Full P3 regression completed with **30 test files / 411 passing tests / 0 failing tests**.
- Full TypeScript `tsc -b`: PASS. Full ESLint (zero warnings): PASS. Architecture ESLint on `packages`: PASS. Vite/Nitro production build: PASS. Existing nonfatal third-party `@vercel/sandbox` source-map warnings remain.
- A real **rollback-only** SQL transaction on isolated Lab verified that `create_evolution_html_campaign_control` and its Job receipt preserve an exact synthetic permit in `public.jobs.metadata`, with no committed rows. This confirms the SQL metadata path, **not** an actual Workflow live run.
- `git diff --check`: PASS; there were no staged changes, commits, pushes, merges or `pnpm-lock.yaml` changes. Production data and MiniMax credentials were untouched.
## Concurrent Lab observation (read-only; not initiated by this phase)

At the final read-only Lab query, one distinct Mission (`project-1794471973744`) had an active Campaign Job (`workflow-control-386fdd09-0b92-46fe-afbd-bd3830e1e776`) and a waiting discovery Job; another completed parse Job was also present. The active Campaign Job had **no `labExperiment` permit**. Its server AI usage ledger contained `request-start` and `request-result` records, the latter with `usage.status=complete` at 2026-11-12 08:29:10 UTC. Lab `evolution_lab_ai_budgets` and `evolution_lab_ai_calls` were both empty. This other work was not started by the P3-J coding actions; its initiator is unknown. The work was deliberately **not cancelled, altered or deleted**. This is a potential concurrent unbudgeted-Lab execution risk and must be reconciled before any new live experiment.

## 4. Explicit limitations / remaining P3-K gates

1. The verified provider **account-level hard spending limit**, precise model prices and request token/cost audit are not established. Do **not** set a synthetic/guessed value for `EVOLUTION_LAB_AI_PRICING_POLICY_JSON`; as currently configured, real Mission admission fails closed.
2. The new 20-minute bound is checked by durable Job reads/DB budget and aborts an **actively executing** Step. It is not a separate guaranteed global watchdog that closes an idle/sleeping Workflow's Job exactly at that timestamp. A dedicated durable timeout reconciler and stop receipt still need end-to-end testing.
3. The P3-I monetary settlement uses conservative model-reported token cost estimates, **not a supplier invoice or verified provider billing ledger**; no generator/Judge live route independence or hidden holdout/Gate F has been established.
4. No new Preview was deployed with this code. The previously deployed Preview at `2ce15c2` cannot validate P3-J's integrated route.
5. Before a live synthetic three-generation HTML Mission: verify account-level hard spend cap, approved generation/Judge route fingerprints, issue exact environment-bound allowlist and expiring policy, obtain an explicit isolated-Preview release authorization, deploy the reviewed feature branch only, then validate timeout/watchdog, provider usage, hidden holdout, immutable Candidate artifact hashes, and Gate F. Never deploy to the existing production app without separate approval.

**Outcome: P3-J local preparatory Workflow admission and cancellation controls implemented; real-model three-generation acceptance remains NOT RUN.**
