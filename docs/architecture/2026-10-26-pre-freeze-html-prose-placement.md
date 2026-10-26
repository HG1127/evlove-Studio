# Preserve original preformatted notes while placing added prose

Owner: Evolution OS maintainers. Date: 2026-10-26. This adds a pure Core compilation rule behind the existing known-renderer adapter, before Candidate freezing.

## Physical evidence

The authoritative confirmation still has acceptance failed at 1/1 and frozen SHA-256 `eb096af64ddfe3f297933d829c0e4a04eea64d0779cb6f01c026ac892159609e`. A new read-only byte audit confirmed the same Original, frozen Candidate and stopped state. The 55/57 result represents two nested `pre`/`code` nodes of one note on slide 112. Its original 57 characters remain an exact prefix, also present in the supplied Candidate text context. The model appended explanatory paragraphs inside that preformatted note. Describing this as deleted Original text is inaccurate; the unchanged retention policy still correctly rejects the expanded non-numbered block.

## Decision

Before a future proposal is frozen, the known-renderer compiler can place an appended ordinary-language explanation into a following paragraph, retaining the complete physical Original `pre/code` bytes and every model-authored character in document order. It then synchronizes the existing derived search index. The Candidate is hashed and frozen only after this compilation, and the resulting bytes require the complete normal Visible, Hidden and independent final gates.

The rule is deliberately structural: a physical full document, unique slide-card identities, a slide-body location, corresponding preformatted positions/counts, unchanged attributes, a simple untyped `pre.code-block > code` text pair, a single-line Chinese prose note, its exact unchanged prefix, and an appended plain-language suffix. Declared code, command examples, changed prefixes/whitespace, numbered examples, nested markup, unknown renderer programs/styles and incomplete/ambiguous structures remain unchanged. Returned prose is escaped as text. No runtime program, stylesheet, named/interactive identity or semantic assertion is generated.

The existing retention algorithm and thresholds are unchanged. The transformation is not applied to stored/frozen/accepted files, does not grant another AI repair, and is idempotent. All text fidelity and structural identity still require actual verification; semantic quality and human usability remain independent requirements.

## Actual static verification and limits

On exact read-back inputs, a local, unregistered preview has SHA-256 `e5d6c2eb261fdae484907387afb0b04de1c97e27db2de9eb079f3cddf301a132`, 314,625 bytes. Only slide 112 is reflowed, existing search indexes remain canonical, all 57 original preformatted/code nodes become exact matches, and the complete parsed body text is identical to the frozen input. Its body-text SHA-256 is `b01d8e9f8a446e7bf2d4ef4a8b970420ee1c83debb8f37b23361a89ce0ef8720`. Script/style signatures, original named/interactive sequences and 111-card order remain retained; a second compilation is identical. These are static facts, not rendered-browser or final acceptance evidence.

An offline browser diagnosis was prepared using the existing pinned local isolation procedure. Docker Desktop was initially stopped; after its diagnostic-only startup, host memory was insufficient. No test container was created, user HTML was not mounted or executed, and Docker Desktop was gracefully returned to its original stopped state. No image pull, external upload, AI call or paid Sandbox request occurred. Browser behavior for this preview remains unverified. The failed trial, reserved final paper, expired windows and failed 1/1 repair remain unchanged.

## Engineering validation

All 192 relevant unit/contract tests in 14 files and all 11 Runner tests passed. Final changed-file lint, `pnpm architecture:check`, all four TypeScript project checks and the unchanged `pnpm build` command passed. Initial build attempts exhausted local memory; the successful checks retained the original compiler configurations and used bounded Node heap settings. The build still reports the existing `node:crypto` browser-externalization warning from `outcome-telemetry-records.ts`; this is not a browser-runtime verification. These engineering results do not change the failed confirmation or prove delivery, business benefit or learning transfer.
