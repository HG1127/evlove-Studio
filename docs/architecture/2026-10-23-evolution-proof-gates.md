# Independent final validation and measured production goals

Status: implemented locally, 2026-10-23. Deployment and production Mission acceptance are separate checks.

## Decision

The existing 23-node flow remains intact. Core owns proof requirements, Harness owns sequencing, and backend composition reads warehouse data and invokes actual validators. No additional infrastructure or inward dependency is introduced.

### Learning feedback

Lesson integration prepends new records. Planning now selects the first bounded set of reusable, non-revoked records, retaining anti-pattern warnings. Superseded/degraded/revoked knowledge cannot be reused as an active method. The selected Next Queue problem and desired outcome are passed into server planning instead of remaining only in the UI projection.

### Production goals

Successful health probes establish deployment health. Production completion additionally requires warehouse statistics bound to the Mission, Candidate, candidate deployment, stable deployment and current goal contract. All target-valued metrics must have matching keys, units and directions, sufficient per-arm samples and attained targets; at least one must show favorable estimated significant improvement. Regression, drift, unavailable reads, stale evidence and identity changes block success and Verified Skill promotion. Rollback can close a failed round and preserve learning without claiming improvement.

The backend reads only configured external telemetry for this proof. Synthetic release-health samples cannot satisfy business goals. Generic Mission PUT cannot mint or alter the server-owned proof. Existing statistical estimates remain observational evidence; this change does not establish randomized causal attribution or cross-task generalization.

### Independent final paper

Before production server Candidate planning, a separate AI invocation reserves a final paper from Original source context and the fixed goal/rubric. Candidate content, diagnosis and repair feedback are absent. Reservation is saved before planning; its content is excluded from mutation payloads and only its fingerprint binds to the Candidate. Duplicate IDs, copied scenarios and missing coverage are rejected.

Ordinary Hidden feedback may drive bounded targeted repair. After that contract passes, Gate F runs the reserved final paper against both current baseline and exact frozen Candidate through the existing real validation ports. It retains a separate result without replacing the ordinary Hidden suite. Final failures do not authorize another targeted repair of that Candidate. A later round reserves a new paper. Final and regression Runner request identities include their different papers.

Gate F, Champion selection, Campaign completion, package construction and delivery all require the final receipt for Candidates carrying the reservation. Removing or changing that proof cannot unlock delivery. Extra final cases are included in round cost estimates.

## Compatibility and limits

Contracts add optional fields. Existing initial-pass v1 evidence fingerprints retain their original serialization; Candidates carrying a final-paper binding use `artifact-proof-v2`. Historical initial-pass records are retained as legacy Hidden evidence and are not retroactively certified as independent final validation. A repaired legacy Candidate without a reserved final paper remains blocked; a final paper must not be fabricated after seeing its repair result.

Local compatibility paths use the shared learning and production-goal rules. Newly generated durable server Candidates use the reserved final-paper policy. No PDF/media editing or Office visual/recalculation capability is inferred from these changes.

## PostgreSQL verification

`scripts/test-html-campaign-postgres.mjs` requires an explicit disposable-database opt-in, a local psql executable and an ephemeral password. It fixes the host to loopback, fixes the database name and refuses a nonempty public schema. `supabase/tests/disposable-platform.sql` provides minimal platform role/storage/publication DDL; application tables and RPCs come from all actual repository migrations. This tests PostgreSQL admission/security/transaction logic, not the hosted Storage or Realtime services.

The local audit applied all 21 migrations on PostgreSQL 16.15 with pgvector 0.8.6, passed the rollback-only integration fixture, then ran two simultaneous connections using distinct start keys for one Mission. The second waited approximately two seconds and returned `mission-active`; exactly one Job existed. Production migration remains a separate rollout step.

Runtime sources: [PostgreSQL Windows binaries](https://www.postgresql.org/download/windows/), [pgvector installation](https://github.com/pgvector/pgvector#installation). The local pgvector package was checked against its conda-forge release SHA-256 before loading.
