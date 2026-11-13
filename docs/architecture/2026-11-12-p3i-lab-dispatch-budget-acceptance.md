# P3-I · Isolated Lab AI dispatch and durable budget validation

Date: 2026-11-12
Workspace: D:\Downloads\evlove-studio-evolve-p0
Branch: codex/artifact-evolution-governance-p0
Lab Supabase ref: jnlbqgpezenmpksyklme
Production ref (read-only comparison only): mlvevgdntlswxbyxmlum

## 1. Actual Lab data-plane acceptance

- Project identity verified as Evlove-Studio-Evolution-Lab, region ap-southeast-2, PostgreSQL 17.11. The project is distinct from production.
- Applied the previous P3-H migration to the isolated Lab through the managed migration interface: `20261112070619_lab_ai_budget_security_invariants`.
- Applied an additive P3-I migration, keeping the already-applied P3-H source immutable: `20261112072412_lab_ai_unsettled_reservation_fence_security_invariants`.
- The Lab now records 26 migrations. Both budget tables have RLS enabled; anon/authenticated cannot execute the reservation RPC; service_role can. Both saved generation and Judge Vault *roles* remain present; credentials were not retrieved or overwritten.
- Executed the rollback-only SQL fixture on the real isolated Lab: enrollment, replay immutability, UUID reuse rejection, monetary cap, incomplete-attempt blockade, observed-cost settlement, unknown-cost pause, cancellation and role permissions passed.
- Ran two independent database-request concurrency checks against temporary synthetic Missions. In the first, with a one-call cap, exactly one reservation was persisted; the other returned `budget-exhausted`. In the second, against the newer single-flight guard, exactly one reservation persisted; the other returned `unsettled-attempt`. Each test used a separate query/request and held a transaction open briefly; this is database-level concurrency evidence, not proof of network model execution.
- Committed synthetic test rows were explicitly deleted. Final readback: **0 Mission / 0 Job / 0 budget / 0 AI call**; 2 previously saved Vault role entries remain.

## 2. Runtime integration added in the independent worktree

- `apps/backend/src/services/server-ai-lab-budget-dispatch.ts` introduces mandatory pre-network Lab Mission checks: trusted Workflow control-job binding, exact usage scope, verified server-only model route/pricing policy, bounded text request with protocol-specific output limit, and atomic Postgres reservation before the physical model HTTP call.
- `apps/backend/src/services/server-ai-usage.ts` now uses the same physical-attempt UUID for budget reservation and usage start. Each retry creates a separate receipt. On provider result or network error, it settles based on conservative token-cost estimation; missing/invalid usage causes a null-cost settlement and pauses the Lab budget. HTTP request retries cannot bypass the reservation callback.
- `apps/backend/src/services/server-ai-lab-probe.ts` preserves the authorized single-call health probe. A Mission control Job cannot borrow a health-probe context to evade durable accounting. Isolated Mission output remains capped at 12,000 tokens; actual dispatch still requires the pricing policy and a budget enrollment.
- `supabase/migrations/20261112193500_lab_ai_unsettled_reservation_fence_security_invariants.sql` blocks new requests if any earlier attempt for the same Mission is still in the `reserved` state. A lost settlement no longer allows a second request while monetary holds are ambiguous. This is server-only and fail-closed.
- The opaque Vercel AI SDK route remains **blocked for Lab Mission** because its physical retry/cost exposure is not sufficiently observable. Ordinary non-Lab routes preserve previous behavior.
- Unit tests use synthetic model bodies and mocked provider/DB transports, including reservation-before-network ordering, missing price policy, expired/mismatched routes, unbounded output or multimodal input rejection, absent usage, model mismatch, and health-probe separation.

## 3. Pricing and spend enforcement boundary

The optional **server-only** `EVOLUTION_LAB_AI_PRICING_POLICY_JSON` is deliberately **not configured** in this phase. Its schema requires an exact Lab project ref, explicit account-level provider hard-spend-cap attestation at or under USD 5, an issuance/expiry window no longer than 24 hours, and exact allowed model/Base URL routes with validated *upper-bound* input/output token prices and limits. Do not place API keys in this policy.

The `input body bytes + 8192` heuristic is a conservative text-only estimate, not provider-billing truth. Settlement cost is inferred from reported complete usage and approved price bounds, **not** an actual provider invoice. Production promotion cannot rely on this estimate. If the provider/account hard cap is not independently verified, no live multi-generation Lab Mission should be armed.

Current official pricing reference (must be rechecked when enabling the specific saved models): https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise

## 4. Verification and known limitations

- Final P3 regression: **26 test files / 393 tests / 0 failures**; focused Lab budget/probe/dispatch-order tests passed. Full TypeScript `tsc -b`, ESLint (zero warnings), architecture ESLint, and Vite/Nitro build all exited 0. Existing nonfatal third-party `@vercel/sandbox` source-map warnings remain.
- Supabase security advisor reports `rls_enabled_no_policy` as INFO for private server-only tables; it also reports 3 *pre-existing* mutable-search-path warnings on unrelated legacy functions. The new budget SECURITY DEFINER functions use an explicit empty search path and service-role-only EXECUTE.
- No Vercel Preview deploy, Production deployment, code merge or push, actual MiniMax provider request, independent Judge live holdout, autonomous three-generation Mission, or Gate F production acceptance was performed.
- Lab stored roles do not prove generation and Judge are different model identities. The operator can verify already-saved roles in the protected Preview through the existing one-click health probes; **do not request API keys again**.

## 5. Next P3-J gate

1. Verify provider-side account-level USD 5 spend cap and exact actual Lab Vault generation/Judge model identities, Base URLs, protocol and model pricing through the authorized UI. Do not extract keys.
2. Configure an expiring server-only Lab policy with conservative pricing and hard bounds after verification. Keep the flag absent until reviewed; missing or unapproved policy is a hard block.
3. Add explicit authorized synthetic Mission enrollment and 20-minute cancellation to the Workflow admission boundary, without changing production start behavior.
4. Obtain separate protected Preview deployment authorization and release only the isolated branch/build, not the production branch.
5. Run one bounded real three-generation synthetic HTML Mission; capture actual provider usage/billing evidence, Candidate SHA-256 lineage, separate Judge and hidden holdout outcomes, Gate F result, and cancellation/stop reason.

This report supersedes P3-H's historical "migration not applied" note for the **isolated Lab only**. It is not an assertion that a live MiniMax evolution loop has passed.
