# Bound newly authored SOP paragraphs before freezing

Status: accepted, 2026-10-27. No dependency-direction exception.

## Evidence

Confirmation eight retained native protection but failed actual paired quality. Its initial Visible understandability fell 96 → 88. The one shared repair produced a Visible Winner through focused improvement, with global quality essentially unchanged; ordinary Hidden still held it, with understandability 87 vs current 97 and configuration detail 93 vs 96. All eight absolute minima remained passing. Independent final was unexecuted and Gate F failed. Unlike confirmation seven, the frozen reports remained present, the failed round settled and no new Baseline or initial Candidate was generated.

Native measurements expose a concrete layout problem: Original's longest sampled paragraph was 93 characters, while the repaired file's slide 64 paragraph reached 1,112 characters, 44 lines and 1,160.5 pixels at width 390. The initial and repaired files contain five and thirteen newly expanded paragraphs above the new construction budget. The supported renderer consumes two paragraph slots in specific components; adding newlines to one slot does not create separate rendered paragraphs.

## Decision

Add a pure Core check, `known-sop-paragraph-budget-v1`, invoked by backend composition after the existing lossless compilation and code-retention check, before freezing. In the already-recognized SOP renderer, each new or edited `p` node in a slide body has at most 240 normalized UTF-16 text units. This is a conservative construction budget intended to prevent the observed wall of prose, **not a universal UX threshold, a user acceptance score or proof of readability**. The unchanged Original text remains exempt within the same section and role, with multiplicity preserved; an exemption cannot be borrowed from another slide/role or copied repeatedly. Inactive script/style/template/noscript content is excluded. Unknown renderers and other formats keep their existing path.

Do not automatically split, truncate, hide or remove authored text. A typed construction error reports section, role and counts without changing bytes. The existing single pre-write correction can return a complete proposal distributing detail across the supplied existing step/card-detail anchors. It shares its allowance with anchor, component-layout and code-retention errors; a failed correction stops before writes. Actual Visible/Hidden/final failures keep their original shared repair budget. Both initial and repair prompts declare the same policy and retain every original goal, fact and renderer constraint.

No original minimum, Winner threshold, safety rule, Hidden paper or independent-final paper is relaxed. No terminal confirmation is resumed or reclassified. The self-reported focus of a Candidate and compliance with this static budget still do not prove all user goals improved; same-paper semantic and operational verification remain necessary.

## Verification

Tests cover the exact budget boundary, distributed short details, unchanged long Original paragraphs, entity/inline-text projection, inactive content, role/section mismatch and duplicate exemption attempts. Composed builder tests demonstrate rejection before writes, one same-context correction, exhaustion without freezing, and sharing with an earlier anchor failure. Existing format, repair and frozen-acceptance paths remain covered.

Release checks passed: 182 related tests in 15 files, 11 Runner tests, production build, package architecture check and lint on every changed TypeScript file.

Static replay through the actual backend composition rejects the unchanged frozen confirmation-eight inputs `09b7d0…` (318,251 bytes, five issues) and `6d3beb…` (343,224 bytes, thirteen issues), both with a largest paragraph of 1,112 characters. Original SHA-256 `660542…`, frozen bytes and the sealed Mission file `9af801…` remain unchanged. Replay uses static parsing only, with zero AI/Sandbox calls, user-script execution or remote writes. A fresh authorized real trial is still required to establish whether model-generated corrections pass the full native and semantic gates.
