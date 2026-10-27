# Controlled task benefit calculations and explicit numeric gates

Status: implemented as an optional policy; no current SOP Mission is enabled or reopened. No architecture exception.

## Reproduced gap

The actual mean-based Outcome analyzer and `productionGoalReadiness` at `84334b0` accepted a synthetic counterexample with 30 independently identified tasks per arm. Stable accepted 28/30, median elapsed time 100, and reported cost per accepted task 1.071429. Candidate accepted 24/30, median elapsed time 150, and reported cost per accepted task 1.125. Its mean elapsed time and mean cost per attempt improved enough to satisfy the configured scalar targets, while no metric had a statistically significant regression. The result was `healthy` / `improved: true` despite failing this pilot's median-time and cost-per-success requirements.

The original diagnostic SHA-256 is `65158573842d44276d71f41e47978130c5565eb0879c48b9143c4ab11f9b0a35`. It is synthetic math evidence, not a real Mission, billing record or business effect. The generic analyzer truthfully describes its configured mean metrics; that scope cannot establish the stronger SOP business protocol.

## Decision

Contracts adds optional Mission `businessBenefitPolicy`, version `controlled-task-benefit-v1`, and optional Outcome `businessBenefit` assessment. A policy explicitly identifies one configured telemetry source/segment, three distinct metric keys, the reported cost currency, and planned task IDs for both arms. Each arm needs at least 30 tasks; all IDs must be unique across both arms. Existing Missions and their generic metric behavior remain unchanged.

Core joins the same source task's three observations: binary acceptance in `ratio`, end-to-end elapsed time in `ms`, and nonnegative reported monetary cost in the declared unit. Task completion timestamps must agree, with one coherent Mission/Workspace/Candidate and two distinct Deployment bindings. Exact replays coalesce. Conflicting replays, cross-arm identity reuse, wrong units, negative/nonfinite values, missing measurements, an incomplete planned cohort or unexpected tasks keep the assessment insufficient. A failed attempt requires the same measurements as a successful one; the implementation cannot drop it from the acceptance denominator.

For complete cohorts the fixed numeric gates are:

- Candidate accepted tasks / all planned Candidate attempts is at least 80%.
- Median elapsed time across all Candidate attempts is at most 80% of the Stable median. A zero Stable median cannot establish a 20% reduction.
- Total reported Candidate cost across every attempt / accepted Candidate tasks does not exceed the corresponding Stable ratio. A zero-success arm cannot establish cost per success. The numeric comparison uses a `1e-12` absolute tolerance for floating-point addition, not a financial rounding allowance.

The result is `insufficient`, `failed` or `thresholds-met`, with explicit counts and calculations. It always carries `establishesCausalBenefit: false`. The old mean-based metric scores and p-values remain unchanged. Under an explicit policy, a failed numeric assessment makes the combined Outcome `watch`; missing evidence makes it `insufficient`. Genuine statistical regressions retain precedence and are not replaced by a weaker state.

Backend composition checks that the policy names an actual configured `independent-task` source and matching kind/direction/unit definitions. It uses the same complete warehouse read as the existing Outcome analysis. The public read API takes the stored Mission policy; query parameters cannot supply a replacement cohort. Production goal refresh preserves the assessment in the existing server-owned receipt. The additional policy is bound into the goal fingerprint only when present, and readiness checks the assessment's policy/time/counts and recomputed numeric conditions. A claimed `thresholds-met` label cannot override contradictory numbers. Existing generic targets, sample sufficiency, regression and learning governance checks still apply.

Contracts contains Zod DTOs; Core contains deterministic calculations; applications select configured sources and read data. No platform SDK enters Core/Harness, and no database migration, new service or paid call is introduced. Existing artifact identity, release controls and 23-node closed-loop requirements remain required.

## Limits and remaining work

A planned task list is not authenticated preregistration or randomized assignment. Source task IDs and configured source names cannot by themselves prove human traffic, invoice authenticity, comparable participants or independent study design. Reported monetary fields are not verified provider bills. Those claims require separate authoritative source/receipt checks, pre-observation study registration and the controlled human workload already required by the real-evolution protocol. A numeric pass is not a declaration of overall real evolution or causal lesson transfer.

Changing a policy invalidates its old goal receipt; it does not authorize changing a completed study's cohort or retrospectively selecting successes. No current Mission has been configured with this policy. Pending authorization for the preserved `bfed67a` trial cannot silently enable this additional policy or substitute this implementation.

Connected verification covers the read API, actual source configuration, complete warehouse analysis, server-owned goal evidence and readiness. Synthetic tests cover the reproduced mean-only false inference, a valid numeric cohort, missing failed tasks, unknown cost, unit/source/deployment conflicts, exact/changed replays, inconsistent completion times, zero successes, policy changes and contradictory receipts. Real business benefit and lesson transfer remain unproved.

Release verification passed 168 related tests across 15 files, all 11 Runner tests, the TypeScript/production build, architecture check and changed-file lint. The labelled local replay has SHA-256 `03f16d1515b695803df11d4b981661a7ab2816c364cbaca2ba906b8329b16abf`: generic mean metrics remain identical, while the opted-in counterexample becomes `watch` / `improved: false`. The legacy goal fingerprint matches the preserved `bfed67a` source.

A fresh read-only audit at `2026-10-27T05:45:06.322Z` still found nine SOP Missions, zero accepted outputs, zero real task observations, zero lessons and no configured telemetry sources/metrics. No new policy was enabled. The latest C8 Workflow exists and is completed, its Job is waiting, and its formal hash matches the sealed failed state. The metadata-only local audit SHA-256 is `21ee32eef025f945311191ae1a9011a25fa5cb6b47d0c450cf4ccf40792a8bff`. There were zero provider requests, Sandbox executions, remote writes or Workflow restarts.
