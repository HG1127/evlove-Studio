# Browser HTML protection runtime handoff

## Scope and source

Integration branch: codex/html-browser-proof-runtime. Runtime code commit36d7f8b2756c088571bba980f46efe66db7a05ca, built on the separate JSON/prerequisite candidate44e1ca3. Source branches0567a77 +df6a8ee and3c3eaf +9d7db99 +e97fd28 were cherry-picked without conflicts. The earlier source branch receipts and failures are preserved.

The closed contract supports explicit scroll-into-view actions, native in-viewport observations, attributes, checkbox state, scroll position, whitelisted computed style, and Sandbox-only native copied-text probing. Browser code is fixed adapter-owned code; supplied evaluate callbacks, regex fields and arbitrary JavaScript are rejected. Existing24-step limits and legacy actions retain their persisted meanings.

Native style, geometry, IntersectionObserver and layout measurements use a positively identified Chromium CDP isolated world; the artifact's main-world overrides cannot substitute those observations. Composed ancestor opacity and native transform matrices are measured. The local Runner rejects copied-text cases before launch and guards Clipboard/legacy copy/cut/paste aliases before artifact code executes. No native host Clipboard was exercised by tests.

A viewport action has selector html and integer width/height240..2560. It calls page.setViewportSize once under the existing platform action deadline, changes dimensions only, and contributes zero assertions. The Sandbox retains7 seconds per action; local Runner retains5 seconds per action/45 seconds per case. Missing capability, rejected resize or timeout remains UNVERIFIED. Subsequent actual menu interactions and native observations must establish mobile behavior; an unrelated resize cannot turn a screenshot-only case into VERIFIED.

Sandbox cache/runtime is v4-typed-isolated-viewport on Playwright1.63.0. Local browser verification uses the same pinned Chromium build.

## Integration evidence

D:/Downloads/evolution-os-smoke-temp/html-browser-proof-integration-20261013-manifest.json pins the exact code SHA and20 unique selected files. The matching tests.json report contains308 passed,0 failed,0 pending, exit0; the normalized report names match the unique manifest exactly. This includes actual generated Sandbox-script synthetic Chromium observations plus contracts, physical/proof foundations, Harness paper checks and backend HTML composition. It contains no real user script, cloud Mission run or native host Clipboard operation.

Runner, architecture, full lint, production build and complete integrated CI must be recorded independently before delivery. A complete gate for44e1ca3 does not cover this newer runtime code.

## Main-flow work still required

The runtime adds execution capabilities. The full-file inventory's unresolved runtime obligations are not automatically upgraded. A trusted whole-scope collector must independently derive the obligation set from exact original/current/frozen files, collect all measured static/browser/semantic observations including failures, seal execution provenance, and restore the expected context through the normal server/Domain path. Search-only generated checks stay partial at criterion level. A client-authored proof, signed ordinary Ledger entry or model tag cannot replace actual execution authority.

The actual original is artifact-2ac80e2f-b1f2-4cb9-a3bf-8587577f767f, SHA2566605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a. Candidate cand-P1-001 frozen SHA2569a616d1a919e18f6f6e606cee02ca9f9617e680c2875bf888fca07f8e863f068 remains draft. Productionfb3a9b5 was observed at17:41 UTC; Mission project-1790480873333 at17:43 UTC is revision43/Baselinepaused, Runwrun_01M4RCNGDXQD3FQF5G6X8ZHMQ5 completed and Jobworkflow-control-c8350647-b291-4067-adca-c2e98da09fd2 waiting after malformed Judge JSON. No actual Experiment, same-Hidden pairing, Gate F or accepted download/reopen is claimed by this increment.

The root coding branch does not push main or deploy. Git/CI delivery owners receive exact verified receipts under existing authorization.
