# Independent saved-model selection identity

## Scope and actual defect

`withServerAiConnection` pins an execution configuration in AsyncLocalStorage. The legacy scoring-route getter deliberately consumes that pinned configuration. Using it alone as a current stored-configuration guard cannot detect a connection change during collection or later file preparation.

The new private App boundary keeps execution pinning and independently checks the stored selection. The initial configuration, complete public settings and metadata come from the same AES-GCM-authenticated Vault row. Its opaque `sealedRecordSha256` commits to metadata and the encrypted ciphertext/IV/tag. Subsequent reads fetch that record identity independently, without decrypting another provider Key. The digest also detects a concurrent replacement with the same version and timestamps; Vault's existing read-version/upsert is not assumed to provide unique revisions across concurrent writes.

`serverAiPublicScoringRouteFingerprint` preserves the existing scoring material and policy versions, including complete-final-context correction and bounded native completion diagnostics. Label, connection ID and credential rotation remain outside that scoring hash; the separate complete selection identity binds those settings and the physical sealed record. No provider, protocol, format, model, request budget or Gateway fallback is introduced.

## Consumption requirements

- `readCurrentServerAiScoringSelection` is the fresh default boundary within a stored pinned execution. It returns the public selection, its identity and the existing scoring fingerprint only when the independently read record still matches.
- `readCurrentStoredServerAiPublicSelection` supports historical restoration only after its caller authenticates the signature over the complete selection and verifies the owner/Run/Job/input context. It does not authenticate an arbitrary settings DTO or mint Core authority. A caller-supplied settings change with an unchanged legitimate record digest is not made trustworthy by an `available` read result.
- The collector, persisted restoration, accepted-file guard and final mutating provider transport must bind this selection identity and recheck it after relevant asynchronous I/O. Those consumers are separate pending work; this increment alone does not wire or prove them.
- Missing, malformed, deleted or changed records remain unavailable. The original identity is compared rather than refreshed to the replacement version.
- Environment and unsaved explicit connections lack a stored credential epoch. They remain supported for normal execution, but this evidence boundary returns a capability gap. No production configuration, Key change, migration or new public database column is requested.

## Development evidence

Evidence directory: `D:/Downloads/evolution-os-smoke-temp/server-ai-selection-20261014`.

- Initial five-file check: 55 passed, zero failures/skips, 1,195 source files unchanged. It precedes three additional negative/ordering tests and is retained independently.
- Updated complete related manifest: 28 unique model/Vault/contract files; 333 passed, zero failed/skipped, 1,195 source files unchanged. `attempt2-test-manifest.txt`, JSON report, command/result and before/after physical source manifests are retained.
- Seventeen default-boundary composition tests use the real Vault encryption/decryption and configuration functions with a synthetic HTTP storage boundary. They cover public-field changes, Key-only rotation, same-version/timestamp sealed-row replacement, a change after initial resolve, deletion/malformed/foreign rows, serialized identity, an unavailable environment epoch and synchronous callback non-replay. No real credential, provider call or user-file execution is used.
- Independent static review found no blocking issue in this increment and explicitly retained the signature-consumption requirement above.

Architecture, full lint, all four forced TypeScript references and normal production build completed with exit zero in `development-checks-attempt1.json`. Its 1,196 source files, including this handoff, were rechecked unchanged. The subsequent edit of this paragraph only records those observed results; implementation and test bytes are unchanged. Exact commit identity and complete CI are recorded separately in the integration handoff; complete CI is still pending for this increment.

## Real acceptance remains incomplete

Latest separately observed production is `0083ec56d47d4eed7fc4f856edc12701a47574bb`, source-equivalent to the previous fully tested `4891e77`; it does not contain this increment. The fresh real Run `wrun_01M4XB014WTS0XH8HGRHKP6S74` completed Baseline `baseline-server-1791986028621` with valid JSON and independent Safety PASS, then paused at an evidence boundary. There is no frozen Candidate, Experiment, same-Hidden pair, Gate F or accepted download/reopen proof.

The exact `VC-WORKFLOW-CLOSURE` input asks for a complete workflow with stage inputs/actions/outputs/completion, recovery paths and adjacent-stage continuity. Its current result remains partial: static SOP text was observed, and runtime closure was not established. The original paper and that partial observation are unchanged. Whole-protection evidence cannot silently upgrade this separate case.

Central Candidate/Experiment/Gate F/download wiring still awaits its specific human scope approval. Native runtime and authority foundations have separate owners and incomplete integration evidence. Prepare a consolidated integration and complete exact-commit CI before requesting dedicated delivery; this standalone boundary is not a reason to restart the same real Run or redeploy unchanged acceptance capabilities.
