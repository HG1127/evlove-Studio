# HTML derived search and readable evidence

Owner: Evolution OS maintainers. Date: 2026-10-23. This decision follows the existing package boundaries and stack; it introduces no architecture exception.

## Observed problem

The exact AI-repaired SOP retained the original scripts and styles and passed 32 existing interaction assertions, but newly added configuration terms were not searchable. A separate paired browser observation found that the new text existed in slide 64 while its `data-search` attribute still contained only the old index. Testing old keywords had missed a real regression. Desktop/mobile screenshots also showed long introductory paragraphs beside brief step cards, a concern hidden by flattened text review.

## Decision

Core parses HTML without executing it. It preserves headings, paragraphs, card boundaries and preformatted whitespace in textual review, with factual paragraph/card allocation counts. These counts introduce no quality threshold and never establish user comprehension. Harness exposes this versioned projection to the existing independent Judge under the unchanged rubric.

A pure compiler refreshes existing card search indexes as the original keywords followed by the current card body text. It changes only physical `data-search` attribute spans. Apps apply it before hashing and freezing a genuinely changed proposal, only when the adapter recognizes the exact supported program/style signatures. Unknown renderers retain their previous path. An unchanged proposal is still a no-op; the compiler cannot manufacture an accepted repair by itself.

The signature guard/compiler has its own public `@evolution/adapters/html-native-profile` entry, without importing a cloud SDK. Application, build and test aliases use this entry, and dependency rules forbid adapter subpath imports from inward production layers.

Static protection reports retain truthful raw attribute equality, separately reporting whether a changed index has exactly canonical contents. Canonical contents do not establish browser behavior. The approved frozen file is never rewritten after testing.

Contracts also define optional native observation receipts. Core validates physical subject, case/source identity, text fingerprint, paragraph facts, complete interaction counts, new-content search queries and two viewport style comparisons. Harness accepts these only through an injected port; duplicate, stale, incomplete or cross-project receipts stay unverified. An Original observation must be a self-observation and must bind the unique physical Original reference before Baseline locking. Passing tool assertions never generate semantic quality scores. A complete, bound protection regression remains a verified failure even if Judge returns a high passing score.

## Rollout and limits

Update, 2026-10-26: after separate explicit human approval, the [Mission-authorized production execution composition](2026-10-26-native-html-production-execution.md) was implemented and verified with real cloud observations. The initially rejected/pending rollout below records the earlier state; it does not revoke that later approval. The failed pilot remains unaccepted, and the passing preview has not been promoted.

The local index compiler, structured review and receipt validation are covered by local tests. The new full-file cloud execution entry is **not wired or published**: its proposed verification and backend entry were rejected by automatic approval because the current explicit user consent covers body text sent to the existing AI service, while separate consent for complete HTML sent to Vercel Sandbox is pending. The executable drafts are retained only in the ignored local validation directory. No new Sandbox upload was attempted after that rejection.

Validation: 304 related regression tests, seven additional pure-profile boundary tests, an additional later-provider-failure regression and all 11 Runner regression tests passed. Bound Original observations survive an unrelated later provider failure; a failed Original read still invalidates them. Local physical-file verification also confirmed the production signature guard recognizes both inputs and that the production compiler produces exactly the same canonical preview as Core. This remains parse-only evidence, not a browser search pass.

Review policy advances to `server-measured-document-review-v2` and static protection execution to `html-preservation-execution-v2`. Existing scores and frozen evidence are preserved; old verdicts are not silently relabeled under the stronger policy. Full independent Visible/Hidden/final verification and delivery of the same bytes remain necessary. The local compiled preview is neither an accepted Candidate nor a delivered Artifact. Business improvement and causal lesson transfer remain unproved.

The narrower alternative of retaining only the old search smoke test was rejected because it had already missed the new-content regression. Manual body rewriting, post-validation index edits and arbitrary paragraph-length pass/fail rules were rejected because they would not demonstrate the required real evolution.

Rollback: disable the known-renderer compiler invocation and retain the prior review route only as explicitly older evidence. Keep all frozen Candidate identities and historical failures. Do not convert missing native capability into a pass.
