# Browser-safe public adapters and Node Outcome collection

Status: implemented locally, 2026-10-27. All paid validation remains deferred.

## Actual broken boundary

The public `@evolution/adapters` barrel exported Outcome collection code that imports `node:crypto`. The production build warned about browser externalization, but its unused exports could be removed from production chunks. A real local Chromium import of the public barrel failed during initialization with `Cannot access node:crypto.createHash in client code`. This failure occurs before a client calls the server-only collector.

The private before receipt SHA-256 is `7dd6feb5218e2f9276148b2c7aa62d765c4bc31c5ad9957b6001922f775aaac6`. The minimal harness also logged unrelated dependency-scan alias warnings; its captured module failure identifies the Node crypto boundary separately. The corrected harness supplies the root alias and limits scan entries. After the fix Chromium loads the public parser with no page/console errors or external requests; receipt SHA-256 is `f4da5f0df02d69d73dad3abb7864324cec61120b5920f252a157acc13fe1eaf2`.

## Decision

Node Outcome collection is exposed through the explicit public subpath `@evolution/adapters/outcome-telemetry`. The backend uses that entry. The browser-safe barrel retains the other public APIs without importing the collector. Package exports, TypeScript paths and Vite/Vitest aliases expose the same subpath; no cross-package deep relative import is introduced. This follows the existing dedicated Sandbox entry pattern and keeps contracts → core → harness → adapters/apps unchanged.

The record implementation, synchronous API, SHA-256 algorithm, serialized identity inputs, deduplication and Zod validation are unchanged. Existing observation IDs and records are not migrated or reinterpreted. No browser crypto polyfill, weaker hash, dependency installation or new platform is needed.

This private package has one repository backend consumer of these functions, and that consumer is migrated in the same change. Retaining a runtime forwarding export in the browser barrel would reintroduce the initialization failure, so compatibility is preserved in the unchanged implementation and explicit Node entry rather than an unsafe browser forwarding shim.

## Verification and remaining limits

The Chromium regression loads the real product and imports its public adapter entry, then parses a synthetic Mission. Node tests exercise collection through the new public entry and cover unchanged task identity, deduplication and rejection rules. Related local analysis and browser file round-trips exercise consumers of the shared barrel. These checks use synthetic fixtures in local/demo mode; no user SOP HTML is executed on the host, and no provider, remote evidence write or Sandbox is invoked.

Local verification passed 140 related tests in 12 files, all 11 Runner tests, architecture checks, changed-file lint and the standard TypeScript/Vite build. The Node crypto browser warning is absent from the new build. Chromium passed the public-entry check, Demo Baseline capability stop, dashboard/upload workflow and all 15 tested format round-trips: TS, Python, JSONL, TOML, YAML, XML, SVG, CSV, TSV, XLSX, XLS, ODS, DOCX, PPTX and ZIP. Each format download matched the bytes checked in the browser.

The first 20-case Chromium run passed 19 and timed out on the release-page heading's existing five-second assertion. A focused rerun retained that assertion, added page/request diagnostics and passed with no page errors. The initial timeout's cause is unproved; its failure log remains separate, and the combined evidence is not described as a clean first-run 20/20 result. This change does not claim Office visual fidelity, spreadsheet formula recalculation or any unsupported format capability.

This fixes a real client initialization defect. It does not establish autonomous SOP acceptance, human business benefit, actual monetary improvement or causal lesson transfer. Those real effects retain the original requirements in [the acceptance record](../real-evolution-acceptance.md), with paid steps skipped under the current user instruction.
