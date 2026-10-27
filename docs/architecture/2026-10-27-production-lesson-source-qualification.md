# Production lesson source qualification

Status: implemented locally, 2026-10-27. Paid verification is deferred by the user's current instruction.

## Reproduced defect

The production learning governor checked release health and measured goals, but treated the presence of `provenance` as sufficient. A local replay of the actual functions at `c8eac67` supplies eight synthetic source contradictions: foreign Mission, Candidate, Deployment or Validation, a changed file hash, missing Snapshot identity, swapped Snapshot/hash pairs and simulated provenance. All eight records retained active `verified-skill` status and entered planning. This is a code counterexample, not a real production lesson or causal transfer result.

The counterexample receipt SHA-256 is `5054c81f071600fe415a8af765dd135ea1a5de46e770ca0a11e1b7954ffd5edc`. The first fixed replay excludes all eight while retaining the valid positive control; receipt SHA-256 is `25ccbd2739e26cb7626528d93859050377e74aeb9071b6b3fc3263ff7847b2ec`. Both are private local diagnostics with zero AI requests, Sandbox executions or remote writes.

## Decision

Core owns source qualification. Contracts retain the existing Zod-validated Lesson and Provenance shapes. Harness and apps use public `@evolution/*` exports; no platform dependency enters Core or Harness.

An active production Skill must have the current source Mission, released Candidate and Deployment, an explicitly Candidate-bound source Validation, unique nonempty Snapshot/source identities and complete paired Snapshot hashes. Concrete Candidate/Champion projections must agree. Available release hash receipts must agree with the same files, preserving the existing complete-array precedence over the legacy scalar receipt. Provenance must identify live observation and valid derivation chronology; a refreshed current health timestamp need not equal the original source timestamp.

The source resolver uses the deployed Champion's saved Validation when a later search replaces the current `validationRun`. If an exact source cannot be recovered, qualification fails rather than guessing. Matching metadata is not cryptographic authentication of the bytes or statistical evidence that a method caused improvement; the existing Artifact, validation, production-goal and freshness gates still apply.

The actual distillation inputs use that same resolver. An injected Workflow counterexample paired source Candidate C1 with the current C2 Validation despite the saved C1 Validation being available. The corrected path supplies C1 with its C1 report and records that same binding; a missing source report stops before calling AI. The existing live Release decision still rejects a later experiment Winner inconsistent with the deployed Candidate. Offline distillation uses the explicitly accepted Candidate. These changes do not permit a new Winner to borrow an old deployment's health or goal evidence.

Invalid certificates are downgraded to non-reusable Lessons with governance history. Their supplied provenance and original negative evidence remain intact; an invalid new record cannot supersede an older degraded record. Offline Missions cannot retain a legacy production Skill certificate. Ordinary draft Lessons and anti-pattern warnings retain their existing semantics and are not certified as proven methods.

The actual server Campaign Plan, durable Next Queue and local compatibility entry points requalify knowledge when constructing model inputs. They do not rely solely on a previous write-side refresh. Registry synchronization uses the same governed projection before storage/embedding, retaining source contradictions as counterexamples. Read-side selection and registry projection do not mutate the source Mission.

## Scope and verification limits

To honor the user's no-paid-steps constraint while preserving the earlier instruction to push verified fixes, `vercel.json` disables automatic Git deployments for the current `codex/custom-backend-models` branch only. Other branches retain their existing default behavior. The push commit uses `[skip ci]` to skip the repository's push/pull-request GitHub workflows; no cloud build, migration, deployment or workflow dispatch is requested. This is reversible configuration, not a deployment or remote CI pass. References: [Vercel branch deployment configuration](https://vercel.com/docs/project-configuration/git-configuration), [GitHub workflow skip instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).

Local tests cover the actual injected planning and Next Queue ports, registry writes with a fake database, contradictory or missing source identities, paired hashes, duplicate projections, stale outcomes, failed supersession, later search compatibility and offline historical certificates. All fixtures are synthetic. No provider, Sandbox, remote database, paid build/deployment or real human task is invoked by this verification.

Final local verification passed 246 related tests in 17 files, all 11 Runner tests, the standard TypeScript/Vite production build, `pnpm architecture:check` and changed-file lint. Earlier failing probes, an interrupted incomplete test run and the initial test-only TypeScript error remain in the private local logs; they are not counted as passing evidence.

The sealed failed C8 Mission remains SHA-256 `9af8019e5c38a93cf3bf1a888bdb41872f8ec9e903f084fdf4e3713348a90939`. No historical score, budget, final paper, accepted output or Lesson is rewritten. This fix establishes source rejection in code; it does not establish an accepted SOP delivery, actual business benefit, verified monetary cost or causal reuse on later unseen tasks. Those required real effects remain incomplete and paid steps are skipped until the user changes that constraint.
