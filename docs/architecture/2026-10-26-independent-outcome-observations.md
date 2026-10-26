# Independent outcome observations

Owner: Evolution OS maintainers. Date: 2026-10-26. This follows the existing dependency direction and introduces no architecture exception.

## Reproduced problem

The collector assigned a new sample ID on every poll of a dashboard scalar. The statistics kernel counted these rows as independent observations. Running the actual analyzer from revision `b850a1a` on 30 repeated aggregate values per arm produced `healthy` and `significant-improvement`, although there were no independent task observations. The corrected analyzer returns `insufficient`, counts zero independent samples and excludes all 60 rows. The local counterexample receipt has SHA-256 `4bc1cc8595dda833ea4b8c79bddd07f41592a842e199632d82d61ee6252ca7be`. It is synthetic diagnostic evidence, not a business experiment or a lesson-transfer result.

## Decision

Contracts add optional, versioned observation identity: `independent-task` with a source task ID, or `aggregate-snapshot`. Existing records without identity remain readable but do not become independent tasks. The analysis reports policy `independent-task-observations-v1`, qualified/excluded counts and task-identity conflicts. Warehouse row IDs, poll timestamps and arbitrary metadata cannot supply the missing identity.

Core counts a task once per metric and segment. Exact replays remain one observation; changed values, changed source-event time, cross-arm reuse or conflicting deployment bindings exclude that task. Cross-Mission rows and mixed Workspace/deployment cohorts cannot establish improvement. Existing comparable-metric checks and minimum sample thresholds remain required. A measured regression remains visible even if another scope is incomplete.

The external record mapper lives in adapters and is imported through `@evolution/adapters`. Application configuration defaults old scalar sources to aggregate snapshots. A task source must explicitly supply record-array, task-ID, completion-time and deployment-ID paths. Source event time is used rather than poll time. Task IDs and payloads remain stable across release traffic changes; conflicting replays and oversized batches are rejected rather than truncated. Finite numeric values are required, and missing/null values are not converted to zero.

The existing JSON metadata column stores the typed identity under reserved key `__evolutionOutcomeObservation`; no schema migration is needed. Readback validates and lifts it into the versioned field. Arbitrary caller metadata cannot impersonate this field. Manual API ingestion cannot claim the reserved configured-telemetry source namespace; only the internal collection path supplies that origin. Production goal analysis uses currently configured sources, and an absent or invalid configuration stays insufficient.

Production goal fingerprints advance to `production-goal-v2` and include the measurement policy. Goal improvement and Skill promotion require the new independent-observation policy with sufficient counts and no task conflicts. Old goal receipts remain stored and require fresh evidence; their prior verdicts are not silently relabeled or reused as current proof.

## Limits and actual state

Source task IDs are necessary provenance, not proof that an experiment is causally independent. The source must represent real task completions. This change does not establish actual monetary billing, a controlled human workload, the pilot's required median elapsed-time reduction or cost per accepted delivery, or transfer to unseen tasks. Mean-based exploratory statistics do not replace those requirements.

A read-only check against the current project on 2026-10-26 found a ready database but zero configured business telemetry sources and zero outcome observations for the real SOP pilot. The complete local health receipt has SHA-256 `c60ce60d246a400c3ed327218e4907ea754ed9665260bbeeee9087508d3ff6ba`. No provider generation, body upload or remote write occurred. Body evidence storage and full-file cloud execution remain subject to the previously requested consent; this work does not bypass either rejection.

Validation: 169 related tests across 19 executed files, all 11 Runner regression tests, architecture checks, changed-file lint and the production TypeScript/Vite build passed. Tests cover a real-function before/after counterexample, task collection, exact and conflicting replays, source impersonation, metadata round trips, legacy receipts, production-goal readiness and learning governance. These test records are explicitly synthetic.

Rollback: disable the configured task source if its external record contract is unavailable. Preserve stored rows and keep the strict readiness policy; display older aggregate diagnostics without promoting them to current improvement evidence.
