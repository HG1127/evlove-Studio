# Evolve Studio — isolated build and local preview acceptance

Date: 2026-11-12 (Asia/Singapore)
Workspace: `D:\Downloads\evlove-studio-evolve-p0`
Branch: `codex/artifact-evolution-governance-p0`
Base HEAD: `60608f7`

## Scope

Restore the isolated P0–P3 codebase's build environment and test its actual local preview without accessing or modifying production MiniMax Vault, Judge configuration, or business Mission data. Preserve all uncommitted work; no merge, commit, push, remote preview deployment, or production deployment.

## Dependency restoration

The original checkout's shared pnpm virtual package cache had most modules, but the standalone worktree had incomplete links. Offline frozen installation stopped at `ERR_PNPM_NO_OFFLINE_TARBALL` for `esbuild@0.28.2`.

Completed a **frozen-lockfile pnpm 11.23.0 install** in the independent checkout with:
- no dependency/version changes;
- `--frozen-lockfile` and `--ignore-scripts`;
- no changes to `package.json` or `pnpm-lock.yaml`;
- no modification to the original project checkout.

## Corrected two test-fixture defects

1. `server-artifact-multigeneration.test.ts`: pass `content: format.seed` to the text artifact fixture. This fixes both the TypeScript argument mismatch and ensures that HTML/Markdown/JSON tests use the declared initial byte content.
2. Preserve the typed `EvolveProject` argument of the `persistProject` test spy while explicitly marking it used. This resolves the full ESLint unused-variable check without losing `mock.calls[0][0]` typing in existing assertions.

## Final validation evidence

| Check | Result | Evidence |
|---|---|---|
| Full TypeScript `tsc -b --pretty false` | PASS, 0 errors | `artifacts/validation/p3-typecheck-20261112.log` |
| Architecture ESLint `eslint packages` | PASS, 0 errors/warnings | `artifacts/validation/p3-architecture-20261112.log` |
| Full ESLint `eslint . --max-warnings 0` | PASS, 0 errors/warnings | `artifacts/validation/p3-full-lint-20261112.log` |
| Full local Vite/Nitro build | PASS, exit 0 | `artifacts/validation/p3-vite-build-20261112.log` |
| P3 regression `vitest.p3.config.ts` | PASS, 19 files, 346 tests, 0 failures | `artifacts/validation/p3-after-lint-fix-tests-20261112.json` |
| Isolated local Nitro GET / | PASS, 200 HTML | loopback-only smoke |
| Isolated Chromium settings page | PASS, no uncaught JavaScript errors | screenshots under `artifacts/validation/` |
| Synthetic local-browser model editor | PASS, unified save button and separate Judge panel visible | `p3-local-synthetic-model-editor-20261112.png` |

The build compiled **4,720 client modules, 86 workflow steps and 2 workflows**, generating `.output/public`, `.output/server` and `.output/nitro.json`.

**Non-fatal build diagnostics:** the bundled `@vercel/sandbox` package references several missing `.js.map` files; the Browserslist dataset is older than recommended. These emitted warnings/error-level source-map diagnostics but the build exited 0. Track before release.

## Isolated preview safety

Launched local Nitro node-server bound to `127.0.0.1` using a restricted environment with **no Supabase, model API or AI Gateway credentials**. External web requests were blocked in Playwright. GET `/` returned 200 and a React root; GET `/api/evolution/ai-connection` returned 503 because Evolution identity/RBAC was intentionally unconfigured.

A fresh browser first showed the expected backend-access gate. Clicking **Continue in this browser only** unblocked local mode without reload, and the settings page rendered. Adding a synthetic browser-only connection exposed **Save connection and sync backend** and the independent Judge panel. No real model call was made; no production data was read or changed.

## Remaining acceptance gates

- The isolated preview cannot use the production Vault just because production MiniMax generation health previously passed. It needs a separately authorized test identity, isolated Supabase/artifact bucket, and authorized model connection.
- The unified save path has not been tested with live Vault persistence in this isolated instance.
- Real MiniMax three-generation HTML evolution with an independent Judge and Hidden Holdout is not yet demonstrated on this branch.
- Native DOCX/PPTX/XLSX internal mutation governance remains fail-closed.
- No remote Vercel preview was deployed; publishing requires an explicit deployment target and authorization.

## Protection

The protected original project remains on `codex/custom-backend-models`, HEAD `60608f7`. Previously present 14 untracked scripts must remain unchanged. All work here is restricted to the separate development checkout, its generated ignored assets, and this independent architecture record.
