# Explicit source citation templates

Status: accepted for opt-in implementation; qualification and formal SOP acceptance remain separate.

The C42 assessment on 2026-11-06 stopped because a source quotation was literal and correctly owned, but its Safety note paraphrased one character. The old protocol required the model to copy the same literal text twice. The failed assessment remains unqualified and cannot be repaired or silently reinterpreted.

An explicit `source-quotation-marker-template-v1` mode uses a separate JSONL header and scoring-route identity. The model copies each quotation once and explicitly places its zero-based `[[q:N]]` marker in the linked note. Missing, duplicate, malformed, extra and cross-note markers fail. The runtime never appends citations to an uncited note. It validates existing complete-document ownership, source/hash, note coverage and literal present/absence rules before returning rendered notes. Absence rendering names both sources and clearly labels which one lacks the literal span.

The original typed templates and claims are journaled before verification. The order result hash still identifies that raw response. A receipt records the rendering version, template hash and derived-note hash separately. Recovery reads the same raw observations under their original route and reruns the checks and renderer. Old v1 responses retain the old literal quote-in-note rule, default routes remain unchanged, and no scoring threshold, Safety state or frozen paper changes.

This guarantees explicit syntactic citation use and literal ownership. Neither a marker nor the old duplicated quote proves the semantic inference or overall Safety. Fresh route qualification and formal Visible/Hidden/final/Gate F evidence are required before accepting any candidate; passing code tests alone does not qualify it. Existing model-call and repair budgets are not expanded by choosing this mode.
