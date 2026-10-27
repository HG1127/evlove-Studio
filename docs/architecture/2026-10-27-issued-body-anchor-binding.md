# Bind omitted HTML build positions to issued body anchors

Status: accepted, 2026-10-27.

## Observed failure

The fifth authorized SOP confirmation ran `8168ce3` and stopped before freezing its initial Candidate. Its sixth edit selected `环境变量、回滚方式、负责人、反馈入口明确。` without source offsets. The physical Original contains this exact string twice: in slide 93's derived `data-search` attribute and in one paragraph. Generic strict text matching correctly refuses a raw-source ambiguity, although the complete, consent-scoped body index already identifies one physical text node. The bounded construction correction did not resolve it. No Candidate experiment, ordinary Hidden, independent-final execution or accepted delivery occurred.

## Decision

Keep generic `applyExactEdits` and its strict matching rules unchanged. A pure Core function validates the existing `html-build-body-context-v1` and model `text-edits` contracts. For an edit with **both positions omitted**, it supplies positions only when `before` equals exactly one complete raw text node in the issued body index. Attribute, script, style and template copies are not body nodes. It does not normalize text, decode entities, locate substrings or invent a range.

Explicit or partial model positions retain the existing contract. Multiple actual body matches remain ambiguous unless the model selects a position. Markup edits remain available through the existing strict editor. The index and its SHA-derived IDs remain server-owned; the model cannot supply a different parent. The existing full physical parent SHA check runs before edits and writes. Multi-target preflight, overlap rejection, protection checks, derived-metadata compilation and exact-byte freezing remain required.

The backend applies this binding only to Targets for which the exact-Mission consent already produced a complete body index, including the single existing pre-write construction correction. Other formats, unconsented HTML and direct materialization callers retain their existing behavior. No AI call, correction count, experiment repair allowance, timeout, score, criterion, Winner rule or independent paper changes. Previously frozen Artifacts and failed trials are never rewritten.

## Verification and limits

The original backend regression fails before the fix and succeeds afterward with an injected model and storage port. Tests retain real body ambiguity, unchanged-Mission consent, changed-parent rejection, atomic preflight, identical correction context, exact frozen-byte readback, raw entity/Unicode offsets, explicit positions, strict markup compatibility and schema rejection.

A static replay on the actual 264,173-byte Original finds 2 raw occurrences, 1 complete paragraph node on slide 93 and 2,044 issued body anchors. The selected physical range is `[173432, 173453)`. The old matcher raises `TEXT_EDIT_ANCHOR_INVALID`; the new binding changes only that paragraph's range in memory. The Original and sealed formal state remain unchanged. No user HTML executes and no paid resource or remote write is used by this replay. This confirms the location fix, not the failed model proposal's complete validity, semantic improvement, browser behavior, acceptance, user benefit or causal lesson transfer.
