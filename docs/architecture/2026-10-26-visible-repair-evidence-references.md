# Complete Visible repair evidence without repeated Mission bodies

Date: 2026-10-26. Status: implemented; local verification. No acceptance or trial-budget changes.

## Measured issue

Visible repair v1 copied the full failed Experiment into every repair attempt. On the sealed third SOP confirmation, a representative inline attempt is 1,816,344 bytes. The Mission already contains that Experiment, so saving a reservation duplicates the measured bodies and execution checkpoints before mutation even starts. Hidden repair already uses private, immutable evidence Artifacts.

## Decision

New Visible repair history uses `experiment-visible-repair-v2`. The opt-in policy remains `experiment-visible-repair-v1`; its meaning, eligibility and shared repair allowance are unchanged. Existing v1 history remains readable with its inline Experiment. Installing this code neither rewrites old records nor silently converts their fingerprints.

A reserved v2 attempt binds the complete current Experiment by SHA-256, in addition to the existing parent/contract/paper/input fingerprint. The report remains in `experimentRun` until mutation. Immediately before claiming running work, Harness archives the complete versioned Visible report through the existing injected private-Artifact port. The application checks Mission/candidate binding, content hash, UTF-8 size, stored metadata and exact-byte readback. Harness checks the returned reference against its expected report. It then saves the reference together with the running claim and cost estimate through the caller's revision-scoped writer, before calling mutation AI. Started v2 records without evidence references fail schema validation.

Missing or failed archiving keeps the reserved attempt, original report and unchanged estimate, with no AI call. It cannot refund or create a new repair allowance. A later explicit resume can retry the same reservation only under the unchanged resource limits; the content-addressed archive is idempotent. The original deadline is checked again after archive I/O and after the durable claim. A conflict or unknown running invocation cannot fall back to another provider call.

Successful and failed invocations keep the full evidence reference. New frozen children must still rerun complete Visible, ordinary Hidden, the original independent final and Gate F. Recovery accepts both history versions without regenerating a different child. The history's reference is not an acceptance verdict. No report is truncated, and final-paper questions are not included in the Visible archive.

## Verification and limits

Injected tests cover exact archive binding, changed reports/digests, missing storage, wrong Mission/parent/hash/size, archive I/O crossing the deadline, CAS conflicts/concurrency, failed or interrupted mutation, storage-schema round trips, and the repaired child's full revalidation and same-byte packaging. The application archive tests exercise both Visible and Hidden reports.

A read-only replay on the sealed SOP validates the complete 1,816,247-byte Visible feedback report and an 862-byte v2 attempt, versus the 1,816,344-byte v1 attempt. The sealed Mission JSON SHA-256 remains `b6c0ec1f3e9ad5ede56f12975c63d6f4e417a9f9dad7cbfc7a271e16023eea6d`. A separate synthetic replay generates a genuine v1 reservation with the preceding implementation, then successfully executes it with the new implementation and no archive capability. Its original inline failure report is unchanged.

These are local contract, durability and size observations. They do not establish hosted upload success, real SOP acceptance, user benefit, actual billing or causal lesson transfer. The sealed Safety-failed confirmation remains ineligible for repair, and its final paper is unconsumed. This work starts no AI/Sandbox trial and makes no remote evidence write.
