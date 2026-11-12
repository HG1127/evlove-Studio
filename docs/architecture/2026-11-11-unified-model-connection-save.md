# Unified model connection save · BYOK to server Vault

Date: 2026-11-11
Branch: codex/artifact-evolution-governance-p0
Base: 60608f7

## Decision

The BYOK provider connection remains the single user-facing connection editor. The explicit **Save connection and sync backend** action now sends that same selected connection to the existing governed server AI connection API, which stores the backend copy in the encrypted Vault and verifies it by reading back the saved metadata/settings. Users no longer need to re-enter the same provider, Base URL, model and API Key in a second generation-connection panel.

The separate Judge role remains separate by design. It can intentionally use a different model/provider and is not silently overwritten when the generation connection is saved.

## Flow

1. User edits the existing BYOK connection in the provider connection editor.
2. The user clicks Save connection and sync backend.
3. Read the latest public generation-role metadata before saving. For the exact same connection ID, normalized endpoint and model, preserve the saved protocol and responseFormat, including MiniMax prompt-json. A different target requires explicit replacement confirmation; unsupported/missing metadata fails closed. A new target without existing settings uses the provider preset and JSON Object default.
4. The client calls the existing PUT /api/evolution/ai-connection route. The route enforces security.admin, validates the request and writes through saveServerAiConnection into encrypted Vault.
5. The client performs the existing server readback and verifies revision, connection ID, label, normalized Base URL, model, protocol and response format before reporting success.
6. The local draft is retained before the request; successful server readback updates the receipt without overwriting edits made while the request was pending. Only one save per panel can be in flight, and stale page-read responses cannot replace a newer save receipt.
7. When the settings page is reopened, the unified connection editor reads the generation-role Vault status and displays the saved server model/connection label. It does not reveal or request the stored API Key.

## Failure semantics

- If the backend API/Vault is unavailable or authorization fails, the browser BYOK copy is retained and the UI explicitly reports that backend sync is not confirmed. It must not claim full success.
- The API Key is sent only in the authenticated request body to the server and is stored by the existing encrypted Vault service. It is never included in returned status, success messages, audit records or logs.
- Only OpenAI-compatible provider presets are eligible for this bridge. Unsupported protocols fail closed.
- The explicit save action is the synchronization boundary; inline edits remain local draft/registry updates and do not trigger a Vault write on every keystroke.
- Deleting a browser BYOK connection does not automatically delete the backend Vault connection. This is deliberate: a backend worker may still use that credential. The UI explains this; replacing the backend default requires saving another connection. Dedicated, role-aware Vault revocation is a separate administrative action.
- The Judge Vault role remains separate. Saving generation never overwrites Judge.
- The generation Vault status is read-only in the UI and refreshed when the Connections tab is opened. A backend read failure is shown as an error rather than incorrectly claiming the model is absent.

## Scope and verification

- New mapping helper: src/features/evolve/ai/server-connection-sync.ts.
- New mapping tests cover custom OpenAI-compatible MiniMax Base URL/model mapping, invalid/missing key/model and unsupported provider rejection, and error-message secret non-disclosure.
- Settings panel now exposes one explicit combined save action and removes the duplicate generation server connection panel; the separate Judge panel remains.
- P3 regression suite: 16 files, 282 tests passed.
- Updated unified-connection regression suite: 19 files, 320 tests passed.
- Focused SettingsPanel TSX syntax transpilation passed; focused connection mapping TypeScript check passed.
- Historical local-only probe: local ports were unavailable. This did NOT prove that the deployed MiniMax connection was missing. Subsequent authenticated production GETs confirmed generation MiniMax-M2.7-highspeed (revision 9) and Judge MiniMax-M3.1-Flash (revision 1), both chat-completions/prompt-json. The generation runtime probe passed at 2026-11-11T10:38:26.305Z; Judge execution was not tested. That response did not include token/cost evidence.
- Focused TypeScript check: tsconfig.p3-connection-sync.json passed.
- No live model call was performed by this code-change validation. No API Key was read from storage or printed.
- No dependency or lockfile changes, no commit, merge or deployment.

## Existing MiniMax settings preservation acceptance

The settings-preservation change was test-driven: the expanded tests initially reproduced the lost prompt-json/Responses behavior and absent synchronization safeguards. After implementation, all 29 connection-sync tests and 9 existing connection-client tests passed. The final P3 regression ran 19 files / 346 tests / 0 failures. Report: artifacts/validation/minimax-connection-preservation-tests.json.

The focused connection TypeScript project passed, and SettingsPanel TSX syntax transpilation passed. Actual React/DOM/browser execution is not covered by those results: react, react-dom/client and @testing-library/react cannot currently be resolved in the isolated workspace. No packages were installed.

Display states now distinguish unconfirmed/error, storage unavailable, unconfigured, different backend target, local edits pending, and matching public metadata. Matching metadata explicitly does not prove key equality or a fresh runtime health check. Edits to key/endpoint/model/label/enabled state mark the current local selection dirty. Existing Judge configuration is never written by this generation action.

The combined save uses fresh GET -> governed PUT -> existing GET/readback. This reduces stale-setting mistakes but is NOT an atomic cross-client compare-and-swap operation; concurrent administrator edits still require a future server-side revision precondition for complete prevention.

No production settings were written and no additional model calls were made in this acceptance turn. Vercel deployment listing for codex/artifact-evolution-governance-p0 returned no deployments in the authorized project. The working branch must pass full build/browser verification and obtain an isolated, correctly authorized deployment before a live multi-generation experiment can validate these changes.
