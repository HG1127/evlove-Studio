# Paragraph grouping and actionable construction feedback

Status: accepted. No dependency-direction exception.

## Evidence

Real confirmation ten ran `faeba7e` with the unchanged SOP and 8/6/9 contract. Its initial builder and existing single construction correction both returned proposals rejected by the 240-character paragraph preflight. No Candidate was frozen, and the new targeted-repair construction policy was never reached. Seven physical MiniMax requests have matched receipts, totaling 449,924 tokens; actual money remains unknown.

The raw rejected proposals were not retained. We cannot identify the actual offending C10 paragraphs or claim an exact replay. Inspection does establish a separate context gap: a text anchor can be a nested inline fragment rather than an entire paragraph, while the budget applies to the combined paragraph. Previously the feedback contained section, role and counts, with no ordinal or text excerpt. A connected local counterexample uses a 160-character replacement that creates a 263-character paragraph; a 137-character replacement fits exactly at 240.

## Decision

Keep all complete body anchors and existing edit permissions. For known SOP renderers only, supplement them with `paragraphGroups` where inline nodes obscure paragraph membership. A direct `p` anchor already supplies the complete text, so it is not duplicated. Each group has its section, ordinal, role, normalized text/count and issued anchor IDs. The optional Zod-validated context field rejects unissued, duplicate and cross-parent anchors. It grants no new editing operation.

Initial construction and authorized targeted repair receive the same grouping function. Unknown renderers retain ordinary body context without invented SOP constraints. All data comes from the existing consent-scoped static body projection; scripts, styles, attributes and independent final questions are excluded. No HTML is executed on the host.

Construction feedback now includes paragraph ordinals and at most 320 normalized characters per issue. Existing correction feedback remains bounded to 20 issues and reports omitted counts. Terminal error messages retain at most five location/count summaries without body text, so the normal failed-Candidate journal can retain useful diagnostics. The 240-character gate, exact-code retention, original long-paragraph exemption and multiplicity/section/role matching are unchanged. Ordinals and source offsets are deliberately excluded from exemption identity.

## Verification and limits

The actual Original retains all 2,044 body anchors. Only two paragraph groups need supplementation: six linked anchors, 407 serialized characters. Local tests cover combined inline length, exact boundary acceptance, unchanged long paragraphs after earlier insertions, parent/anchor identity, script exclusion, unknown renderers and both build/repair composition paths. These are static and injected-port observations. They do not establish that MiniMax will produce an accepted Candidate, business improvement or causal transfer. C10 remains sealed and terminal.

Final checks passed 218 related tests in 15 files, 11 Runner tests, TypeScript/production build, architecture check and changed-file lint. New model behavior remains unverified.
