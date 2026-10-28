# Supply Original HTML element facts before blind paper generation

Status: implemented for validation, 2026-10-28.

C18 passed complete-user-goal Visible validation and all nine ordinary Hidden cases. Its frozen independent final nevertheless held the Candidate after an actual external browser count assertion failed. Static inspection of the unchanged Original and frozen Candidate found 111 `article` card roots and no `section` with the card IDs. The declared assertion used `section`. The prior complete planning context supplied body text and an outline's ID/title but omitted actual element tags and class counts. An outline entry did not establish a DOM element type.

## Decision

Emit `planning-document-context-v2` from the existing consent-scoped, physical-SHA-bound HTML reader. Preserve the strict v1 reader and its exact old shape. V2 adds actual outline element tags and separately versioned `html-static-locator-facts-v1`: body tag counts, ID-to-element/class observations and per-element class counts. Duplicate IDs remain observations; repeated classes on one node count once. These are static source markup facts, with no runtime visibility, copy behavior, screenshots or PASS claim.

Pure Core extraction uses the existing parse5 dependency. It excludes head, script, style, template, noscript and SVG subtrees, arbitrary attributes and raw programs. Contracts validate the DTO. The adapter retains the same exact-Mission body consent, parent hash, source/version binding and unchanged complete-context budgets. Oversized facts fail closed rather than silently truncating. The old `htmlPlanningDocument` API and bounded fallback keep their legacy projection; callers explicitly choose the new complete version.

Harness forwards validated facts to blind final reservation from Original only, before Candidate planning. Current Champion facts can enter later planning without leaking into Original-only reservation. The execution contract instructs the evaluator to ground selectors in observed source element identities and to execute browser assertions through their declared external route. It retains arbitrary valid selectors and all original requirements; there is no hardcoded element whitelist, semantic substitution or preflight rule that discards genuinely failing Original behavior.

No existing paper, C18 result, threshold, repair allowance, reservation window, output or Lesson changes. Executed final feedback still cannot trigger targeted SOP repair, and Candidate generation cannot replace a spent final paper. Storage remains generic versioned JSONB; no database migration or new dependency is needed. This follows the existing layer direction without an architecture exception.

## Validation and limits

Focused tests cover strict version isolation, truthful tags/classes, excluded attributes/programs, duplicate observations, no silent overflow, exact-parent reads, consent boundaries, Original-only reservation, Champion isolation and no final-question leakage. Existing final immutability, native negative-evidence and body/build-context regressions remain required.

Static replay through the actual source-reader and Harness projection on C18's 264,173-byte Original (SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`) produces 111 correctly tagged card entries. Complete documents use 59,085 JSON characters and the forwarded context 63,257, within the unchanged limits. Nine physical program/style blocks remain excluded. No HTML/JavaScript was executed, no model or Sandbox call occurred, and C18's terminal formal hash stayed unchanged.

This fixes missing source information, not all possible model-generated assertion errors. A new independently registered real trial is still necessary. Local checks do not establish accepted delivery, real human/business benefit, actual monetary cost or causal Lesson transfer.

Release checks passed 94 tests in 12 related files, 11 Runner tests, the architecture check, changed-file lint and the full TypeScript/production build. An initial sandbox permission error prevented dependency loading before tests started; the approved local rerun and its log are retained separately.
