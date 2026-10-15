# Main-flow Source boundary recovery

## Actual failures on 2026-10-15

Production `72844afae8ac5df4abfd0723f432cbe5bc22a3d7` has the same tree as the twice CI-tested four-file registration replay repair `39f393745315e27e8bd2b68615287b391453620e`. That CI does not prove a real Mission accepted.

The independently approved fresh Mission is `project-main-flow-sop-b2663c8f-f695-436a-a219-691ff27fe273`. Its Original is already normally registered as `artifact-76737c87-70b9-4eb3-882d-bc0f3011f894`: 264173 bytes, SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`. No upload or registration is repeated.

The normal same-Source reconcile returned HTTP 500 at 02:08 UTC. Official production request `jw5fb-1792030089229-03726945527b` shows `ArtifactMetadataSchema` rejecting `createdAt` and `updatedAt` inside the Supabase adapter's `getMetadata`, before registration Event replay is reached. The earlier replay fix is therefore not yet verified by this real reconciliation.

A separate complete-file `understand` request returned HTTP 500. Request `rnn2m-1792030225414-8da6ef6d58c3` proves `AI_OUTPUT_INVALID_JSON`, initial chat-completions, `finish=stop`, 5556 final bytes and 1147 output tokens. The result is not an understanding brief. Earlier requests with missing client responses remain unverified.

Private-safe failure receipt and retained request/response/log hashes:
`D:/Downloads/evolution-os-smoke-temp/server-ai-selection-20261014/sop-new-mission-authorized-20261015/root-production-boundary-failures-safe-receipt.json`.

## Changes

- The Supabase adapter validates database ISO timestamps with explicit offsets, then maps them to the existing UTC `Z` ArtifactMetadata contract. Fractional digits are preserved, including microseconds; malformed, missing, unzoned and impossible times still fail. No stored row is rewritten. Artifact identity/hash, scope and all other contract validation are preserved. This normalization remains in the adapter; Domain and Harness are untouched.
- Completed invalid JSON from the `understand` operation can use the existing single correction through the same connection, protocol, model, original evidence and absolute deadline. Complete rejected final text stays private and bounded by the existing 2 MiB final / 4 MiB wrapper / 32 MiB request limits. Missing/nonfinal/refused replies, transport failures and exhausted corrections stay failures. No parser repair, verdict retry, fabricated understanding or gate approval is introduced. The recovery policy version changes explicitly.
- This branch starts directly at deployed `72844af`. Paused PR #22 and central31 are excluded. The two existing files were inspected against the production base before editing.

The database representation follows the existing [Supabase UTC guidance](https://supabase.com/docs/guides/database/postgres/configuration) and [PostgREST timestamp representations](https://postgrest.org/en/stable/how-tos/working-with-postgresql-data-types.html). The fix does not change database timezone or migrations.

## Validation and remaining work

The initial timestamp reproduction had five failed / five passed tests. The initial understanding reproduction had four failed / three passed tests. Preliminary tests on the older composite development checkout are retained as such; final evidence must bind to this isolated production-base branch.

Record final focused tests, architecture, full lint, production build, exact commit/tree, and logs in the branch handoff under the temporary directory. Full exact-commit CI, dedicated Git/CI delivery, actual deployed SHA and fresh same-Source reconciliation remain required.

The new Mission remains revision 0 with no Source-bound payload, Target Ready, Baseline or frozen Candidate. After actual delivery: reconcile the same Source, obtain and review a fresh complete understanding response, apply normal Mission revision CAS and the human-approved Target Ready contract, then normal `/start` with one stable key. Preserve the approved criterion, visible/hidden case changes, 92 threshold and all other protection requirements. No past ready state, measurement, Candidate or success is copied. Experiment, same-Hidden pairing, Gate F, identical accepted download/reopen and all later acceptance evidence remain required. PR22/central31 holds remain unchanged.