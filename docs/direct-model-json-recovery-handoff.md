# Direct model JSON recovery handoff

## 2026-10-13 local increment

Main flow Mission `project-1790480873333` is still paused at revision43 after the normal RCN Workflow completed. Baseline `baseline-server-1791820007542` has two verified whole-file static observations, three unverified semantic observations due to invalid JSON, and an original-only deferred protection comparison. Independent Judge failed JSON parsing. Fresh Experiment, paired frozen Hidden, Gate F and exact accepted download/reopen remain unproven.

### Implemented

- Strict final JSON parsing now reports a fixed syntax category without exposing rejected text, keys, native parse excerpts or positions. It never repairs JSON or changes artifact strings.
- Completed semantic `execute-artifact-batch` observations and independent Judge can request one structural correction. The evidence payload, protocol, response format and original deadline are pinned; the corrected result must pass strict JSON and its task Zod schema.
- Correction requires explicit Responses `completed` or Chat `stop` metadata. Valid compatible JSON with omitted metadata can still pass the task schema; malformed or invalid-shape output with unknown completion cannot authorize a retry.
- Only the local parser's error class can authorize JSON correction. Remote error codes alone cannot do so. Candidate malformed JSON, refusals, nonfinal output, transport failures and duplicate semantic identities do not authorize syntax correction.
- Responses rejects root, item and content refusal before selecting aggregate text. Refusal fields have bounded Zod contracts. Errors never echo refusal text.
- Scoring route identity includes the new final-output, Responses refusal and recovery versions. Cached results cannot silently cross this policy change.

### Actual local evidence

33 unique related files /370 passed /0 failed /0 pending; architecture check, full lint and TypeScript/production build all completed exit0. Manifest and logs are in `D:/Downloads/evolution-os-smoke-temp/direct-model-json-*20261013.*`.

Retained failures: first broad regression342 pass/3 stale fingerprint assertions; initial build failed on erasableSyntaxOnly parameter property and a test unknown type. Both were repaired and the complete related manifest rerun. Independent read-only review found mixed Responses refusal and unknown completion eligibility gaps; both were fixed, reviewed again and retested. The pre-review passing run is historical, not the final revision.

### Actual provider health evidence

Existing saved direct route: MiniMax-M2.7-highspeed at api.minimaxi.com, chat-completions/json-schema, saved revision2. Two normal production API health checks used generated synthetic inputs only:

- Two numeric evidence chunks, each77566characters: HTTP200 in34958ms, both case and criterion identities matched.
- Generated Chinese HTML tutorial87565characters with quotes/newlines: HTTP200 in28999ms, all three semantic case identities matched.

Both checks identify currently served production SHA `fb3a9b540fc9bb9b860fd8e1778ec19c86abbb1c`. The second before/after identity matches. The first helper erroneously compared the volatile checkedAt field; that observation is retained and explicitly corrected, not a deployment failure. These checks demonstrate the existing route's structured health and do not prove this unmerged branch or actual Mission acceptance.

Raw actual-Mission model-response capture was not executed. Automatic approval review rejected that extra diagnostic export purpose; the optional approval remains pending. A local direct synthetic probe also stopped before provider I/O because saved local environment copies were redacted; the safe existing production API path was used for synthetic health.

### Delivery and remaining work

Complete independent CI against the exact clean candidate commit is still required. Git/CI owners handle merge/deployment; Root has not pushed main or deployed. After an exact-SHA deployment is verified, use normal checkpoint recovery with new idempotent identity for the approved real Mission; do not manually repair its Job or rewrite failed results.

The separate HTML protection foundation and typed browser branches remain development evidence. Whole-scope authority collection, runtime wiring, semantic coverage, same-Hidden pairing and Gate F must still be proved. Typed browser measurement must use an isolated observer before contributing authoritative proof. No migration, mutating Cron, blob deletion, production secret change or user HTML commit occurred.

## 2026-10-13 — Complete CI prerequisite repair

The first complete local gate for 90d708a stopped at unit-batch-17: the generated browser-runner suite could not launch the root Playwright 1.63.0 Chromium headless shell from the isolated CI browser directory. Its beforeAll setup left17 cases pending; this is a failed required stage, not passing unit coverage. The immutable failed attempt remains in D:/Downloads/evolution-os-smoke-temp/ci-direct-model-json-90d708a.

Quality Gate now installs pinned Chromium before the full Vitest suite. Local fallback uses the same preparation order and a new complete exact-commit attempt. No failed or missing stage is bypassed. The new complete gate and production deployment are still pending; the real Mission remains baseline/paused at revision43.
