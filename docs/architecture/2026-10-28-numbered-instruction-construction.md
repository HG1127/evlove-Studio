# Coherent numbered instructions before freezing a known SOP

Date: 2026-10-28

Status: accepted; this is a construction check, not a semantic or business-improvement verdict.

## Actual evidence

Static parse-only inspection of the exact sealed C21 Original/initial/repaired bytes confirmed that an Original list item `7` (mobile/narrow-screen usability) became a second `8` (console errors). Repair restored mobile wording in the other `8`, leaving the numbering duplicate. All Original inline code strings remained present; the changed text blocks did not exceed the existing paragraph budget. Code/style retention and short paragraphs therefore did not establish operational coherence.

## Decision

Core owns pure `known-sop-numbered-list-coherence-v1` parsing and a typed construction error. The existing backend compiler invokes it after derived metadata compilation and before any frozen Artifact write, on the same known-SOP route used by both initial generation and repair. Other formats and unknown renderers keep their existing routes.

Changed manually numbered direct list items must have consecutive explicit ordinal prefixes. Additional steps, reordering, rewritten explanations, zero-padded labels and coherent renumbering remain possible. Normal bullets, native `<ol>` markers and decimal text are outside this text-prefix check. Head/program/style/template/noscript/code/pre content is excluded; nested lists are inspected independently. Unchanged legacy malformed groups retain their old status through a section/text multiset, without being declared valid. No content is automatically renumbered, truncated or deleted.

The existing model construction instruction describes this constraint. The existing single pre-write correction receives bounded section/list/item/expected/observed locations from the typed error, never fabricated anchor IDs, actual independent-final feedback or a new retry budget. A forged plain error object cannot obtain a correction. This is not a new quality threshold or a relaxation of any Visible, ordinary Hidden, independent-final, Safety or Gate F condition.

## Verification and limits

Tests cover duplicates/gaps/mixed prefixes, legal expanded lists, nested and excluded content, unchanged legacy groups, bounded feedback and the real repair materializer with no write before correction. Static replay of actual C21 initial and repair bytes rejects the same seventh-item conflict; unchanged Original and C18 lists are not relabelled failures. Their formal Mission hashes remain unchanged. C18's independent-final rejection and C21's cancellation remain authoritative.

Consecutive labels cannot prove preservation of an item's meaning, correct cross-references, readability, user efficiency or causal learning. All those requirements still need their own evidence. This change does not constitute automatic cross-Mission learning; the existing planner reads project-local history/Lessons, while fresh confirmation Missions have not yet demonstrated measured experience transfer.

A fixed-clock, fully intercepted replay of the actual C21 preplanning checkpoint reproduces provider request-body SHA-256 `1b53d35d81ba7de5fcb5aa27825e00d0c9544f23411164f6778ae5818ea1431c`, identical to the physical captured request. Its `existingLessons` and `recentArchive` counts are zero and `gapAdvice` is absent. No real provider, execution or remote-write call occurred. This directly establishes the absence of prior-failure reuse in that actual request, rather than inferring it only from missing output Lessons. The next learning work must add traceable source-qualified failure observations and later test their causal reuse; it must not turn failed or final-feedback-contaminated content into a Verified Skill.
