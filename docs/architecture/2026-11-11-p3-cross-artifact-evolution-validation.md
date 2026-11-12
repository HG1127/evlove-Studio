# P3 · Cross-artifact evolution validation

Date: 2026-11-11
Workspace: D:\Downloads\evlove-studio-evolve-p0
Branch: codex/artifact-evolution-governance-p0, based on 60608f7; no commit or deployment.

## Scope

P3 adds a cross-artifact regression layer over the P0-P2 governance, lineage, repair and acceptance path. It does not claim live-model autonomy or production readiness.

## New test coverage

The existing multi-generation fixture now accepts an explicit text artifact descriptor and validates two sequential generations for:
- HTML (complete html/body container, exact frozen bytes);
- Markdown (exact UTF-8 body);
- JSON (structured text format validation and exact frozen bytes).

Each case serializes and reparses the parent Candidate before generation two, then verifies the second frozen artifact and two trusted lineage receipts. The original source authorization remains unchanged.

Existing ZIP tests continue to verify three generations, preservation of protected files and binary assets, serialized continuation, lineage tamper rejection and policy preservation.

Governed native Office writes are deliberately rejected until a native package-part/cell mutation guard exists. The write-governance suite now covers DOCX, PPTX and XLSX rejection before persistence. The existing accepted-artifact renderer suite separately exercises DOCX/PPTX/XLSX rendering; rendering support is not mutation-governance support.

## Final P3 Vitest result

Command: `node node_modules/vitest/vitest.mjs run --config vitest.p3.config.ts`

Result: **15 test files passed, 279 tests passed, 0 failed**.

Included suites:
- AI Gateway: 34;
- AI Build Contract: 13;
- Artifact Renderer: 8;
- multi-generation artifact lifecycle: 17;
- plus P0-P2 governance, lineage, repair, request-boundary and experiment regression suites.

AI Gateway tests use mocked provider transport. All multi-generation tests use scripted proposals/judgments but real Blob/ZIP bytes, hashing, materialization, lineage verification and the existing Harness repair state machine.

## Live-model execution gate

A non-secret environment-presence probe found no configured `EVOLUTION_AI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_GATEWAY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`, and no local .env variants in the isolated workspace.

The current server AI path can also use an encrypted Supabase Vault connection, but its Supabase server credentials are not available in this workspace. No live model request was sent and no API spend was incurred. A live-model experiment must wait until an authorized server-side model connection and data-plane connection are configured, with a bounded call/token budget and disposable Mission/artifact store.

## Full-workspace checks

- Focused P2C TypeScript contracts/Core/Harness lineage check: passed.
- Full `tsc -b --pretty false`: failed, 9,976 diagnostic lines. The visible diagnostics include missing `@babel/parser` and Chai/Vitest assertion typing errors (for example `Assertion.not`); this is a mixed dependency/type-environment failure, not 9,976 independent product defects.
- `npm run architecture:check`: blocked because ESLint is not installed/resolvable in this isolated workspace.
- No dependencies installed and no lockfiles changed.

## Remaining P3 work

1. Configure the server-side encrypted AI connection and Supabase data plane; do not put secrets into source files or test reports.
2. Run a bounded real-model repair mission against disposable HTML/Markdown/JSON/ZIP artifacts, recording prompts, provider/model identity, usage, costs, every candidate hash and independent evaluation.
3. Add native DOCX/PPTX/XLSX package-part/cell governance before enabling mutations for those formats.
4. Restore the complete dependency/type/lint/build environment before merge.
5. Keep Hidden Holdout and Gate F isolated from the proposer and maintain existing repair budgets and stop conditions.
