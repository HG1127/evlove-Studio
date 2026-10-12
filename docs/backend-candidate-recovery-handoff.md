# Backend Candidate construction recovery

## Main-flow gap and bounded implementation

The server previously stopped the Experiment at its build-pending checkpoint when the first output had a wrong/ambiguous/overlapping source anchor, a full rewrite from partial context, no actual change, or an HTML protection violation. Browser construction already had one targeted repair. The actual large HTML path already supports strict text-edits replay on complete uploaded/accepted-parent bytes; increasing a fixed output budget is not its required repair.

Contracts now define versioned construction-failure and boundary DTOs. Harness owns one content-only recovery controller through injected initial/prepare/recover ports. The backend marks only generated text/edit/mode/missing-Target/no-op/HTML protection faults before freezing as recoverable. Every recovery reuses the same Candidate plan and complete parent, with a generation digest including Mission, Candidate, patches, round and parent/protection-baseline hashes. The generation is an explicit boundary; this slice does not claim provider call deduplication across a lost Workflow response.

All text parents are read and identity-checked before generation. An accepted Champion that requires original HTML protection also pins its actual original baseline before generation. Missing source bytes, invalid UTF-8, mismatched parent receipts, same-size parent/original drift, foreign/duplicate Target IDs, unsupported materializers, provider/nonfinal/schema failures and storage write/readback faults are not repaired by regenerating content. Recovery currently applies to complete text Target sets; binary/Office/ZIP construction keeps its existing behavior.

Recovery carries bounded failure and previous blueprints, plus source-verified unique anchors whose offsets refer to the complete parent. Anchor text consumes the same per-Target22k/overall72k text budget as retrieved source, with at most2k reserved for complete anchors per Target. No truncated anchor is presented as a real anchor. Target identity checks run before output-mode recovery classification. Strict exact edits and all original HTML guards rerun; all Targets prepare successfully before any freezing. One remaining content failure stops with both reasons, without a third model call. Initial/recovery provider or persistence faults retain their existing failure classification.

The existing actual-byte renderer, freeze/readback SHA-256, Experiment checkpoint and independent Hidden/Gate F remain authoritative. No accepted file is regenerated, no original Blob/history is deleted, and no Campaign is reset by this change.

## Source and local evidence

Managed branch: `codex/backend-candidate-recovery`, based on `e843c720665e0a342e0c339b7c1ceb345042fc30`. The parent is final-JSON development source in draft PR6; integration depends on that verified source, not a repeated cherry-pick of its old parent chain. The separate committed SHA and changed-file hashes are in `candidate-recovery-development-handoff.json` / `candidate-recovery-build-source-hashes.json` under `D:/Downloads/evolution-os-smoke-temp`.

The owned D-drive execution checkout was checked against every previous final-JSON hash before advancing to exact e843c72. Independent frozen offline dependencies were retained. Original dirty project files and the user's dev server were not modified.

Evidence files use the `candidate-recovery-` prefix:

- `before-tests.log`: unchanged parent source, 11 failures / 5 passes, reproducing missing repair and parent pinning.
- `first-tests.log`: seven suites /79 passes before audit additions.
- `safety-tests.log`: seven suites /87 passes after original-baseline, identity-order and shared-budget additions.
- `final-main-flow-tests.log` and `final-tests.json`: exact final source and complete executed-suite list; includes native HTTP direct-model Chat/Responses construction, strict Core edits, Experiment/recovery/wait, paired Hidden, office compatibility and Gate F.
- `architecture.log`: first concurrent architecture process failed host memory allocation. It was confirmed terminal; subsequent checks were run sequentially. Final architecture/Lint logs are retained separately.
- `first-build.log`: test-only empty-array inference mismatch; typed the fixture as BuildCandidateAiResult, then final production build passed.
- `final-build.log`: TypeScript/Nitro production build.
- Runner and compiled/production read-only receipts are named explicitly in the development handoff; their exact observed scope is preserved.

Native HTTP tests send only synthetic text and credentials to a loopback fixture through the public explicit server connection and real fetch, with two protocols and two replies each. They validate bounded source/anchors, zero freeze writes before the recovery request, corrected whole-parent content, changed candidate hash, actual frozen-byte hash and persisted readback. Storage is an injected memory fixture. This is service-boundary execution, not a live user model or real Mission acceptance.

## Delivery state and remaining real acceptance

GitHub Actions account billing/payment/spending-limit failure prevented main e3482e75 and draft PR6's first jobs from executing any step. [PR6](https://github.com/HG1127/evlove-Studio/pull/6) stays draft/UNVERIFIED. Required hosted CI/production checks for this branch are pending. Keep local/draft integration state until platform gates can run; do not repeatedly retry deployment or change billing.

Read-only production evidence applies only to its explicitly observed deployed SHA. It does not prove this local branch. Account-holder Actions allowance/billing recovery, operator/Vault setup, an actual user-added model/key and original/Candidate cloud-export authorization remain recorded manual work.

Real Mission `project-1790480873333` still requires a fresh changed frozen Candidate, same-Hidden current/Candidate execution, Gate F, exact accepted download SHA-256 and reopening that file. Synthetic hashes and local checks do not satisfy those requirements. Root made no main push, deployment, secret/configuration change, production Cron or real business Workflow call.
