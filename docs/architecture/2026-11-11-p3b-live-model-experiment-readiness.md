# P3-B · Live-model evolution experiment readiness

Date: 2026-11-11

## Current decision (supersedes the initial Runner-only observation)

The three-generation experiment has NOT run. However, missing local Runner variables are no longer a model-configuration blocker: authenticated production status reads confirmed the existing generation MiniMax-M2.7-highspeed (revision 9) and Judge MiniMax-M3.1-Flash (revision 1), both chat-completions/prompt-json. The generation runtime probe succeeded at 2026-11-11T10:38:26.305Z. No key was retrieved or re-entered; Judge execution and usage/cost remain unverified.

The remaining issue is the runtime boundary: the independent branch has no matching deployment in the authorized Vercel project. The existing production deployment is the old base, not these uncommitted changes. A live experiment must use a verified isolated build/data plane under the agreed permissions, not silently mutate production or copy out its secrets. No deployment, production write, or new model call occurred in the latest settings-preservation turn.

## Existing experiment entry point

The protected main workspace already contains an untracked script:
`scripts/live-autonomous-html-mission.mjs`.

Inspection confirms that it:
- only accepts a localhost/127.0.0.1 HTTP origin;
- defaults to dry-run and requires `EVOLUTION_AUDIT_WRITE=1` before creating/starting an audit Mission;
- checks operator-session and local sandbox readiness;
- refuses to bypass compiled Nitro operator authentication;
- creates a unique audit Mission and starts the existing durable workflow only after explicit opt-in;
- polls the exact Mission and control Job.

The script is in the protected main workspace, not the independent P0-P3 worktree. It was inspected read-only and was not copied, modified, or executed. The separate document smoke script was not present in the independent worktree; do not assume it is available in this branch.

## Initial presence-only environment check (historical; not deployed model status)

The isolated Runner environment was checked without printing secret values. All were absent:
- EVOLUTION_AI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, AI_GATEWAY_API_KEY;
- SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY;
- VAULT_ENCRYPTION_KEY, VAULT_MASTER_KEY;
- .env, .env.local, .env.development, .env.development.local.

The application supports a saved generation connection in encrypted Vault and an optional separate Judge connection. The configured Vault connection cannot be verified from this isolated Runner without the server-side Vault/data-plane being available. Presence-only environment checks are not proof that the deployed app has or has not saved a Vault secret.

## Required live experiment gate

Before any live call:
1. Run a local isolated Evolve Studio server with a disposable Supabase project/schema and a dedicated artifact bucket. Do not point the audit at production.
2. Reuse the existing generation and Judge connections through an authorized server runtime. Do not ask the user to configure the same keys again or export secrets into source, command arguments, test reports or this document. Preserve the confirmed protocol and prompt-json setting.
3. Confirm the local operator session and sandbox-auth status. Use the existing script's dry-run first.
4. Require explicit live opt-in, a maximum of 6 generation/repair calls, a maximum of 12,000 generated tokens per call, a maximum experiment spend of USD 5 (enforced by provider/project budget controls, not just a script variable), a 20-minute wall-clock deadline, and cancellation on timeout.
5. Run one synthetic HTML Mission for at most three generations. Preserve the initial baseline and all prior accepted capability tests. The proposer receives visible failures only; hidden holdout prompts and answers remain isolated.
6. Use the existing independent evaluator/Judge and Gate F to decide acceptance. Never allow the generator to self-certify a Champion.
7. Record provider/model identifier, request count, actual usage/cost evidence, per-generation SHA-256, visible and hidden evaluation outcomes, lineage receipts, and final stop reason. Redact all credentials and private test content.

## Initial Runner readiness snapshot (historical, superseded by current decision)

| Gate | Status |
|---|---|
| Existing HTML live-audit harness | Located in protected main workspace; not modified |
| Isolated local origin | Not configured in independent workspace |
| Encrypted generation connection | Not verified / no credentials in Runner |
| Independent Judge connection | Not verified |
| Disposable Supabase data plane | Not configured |
| Explicit provider/project spend cap | Not verified |
| Live AI calls | 0 |
| Live Mission writes | 0 |

## Latest no-change boundary

The initial Runner-only inspection made no API call. A later authorized production generation health probe succeeded as noted above. The latest settings-preservation implementation made no further model calls or Mission writes, did not change Supabase/Vault production configuration, and did not install dependencies, change lockfiles, commit, merge or deploy.
