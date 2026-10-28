# Share file observations within one historical preparation

Date: 2026-10-28

Status: accepted optimization; complete evolution acceptance remains unproved.

## Measured work

C30 reached one queued, unbuilt Candidate before its original deadline. A subsequent read-only trace revalidated the terminal Mission/Jobs and all seven matched model observations, then ran the real historical-failure preparation without a provider, execution environment or remote write. This preparation made eight HTTP reads: two source-Mission reads surrounding qualification, plus three metadata/download pairs. The same frozen Candidate was downloaded twice because direct snapshot verification and execution-fingerprint reconstruction each independently used the global Artifact store. The Original was downloaded once. This trace took 27.356 seconds; separate slow Mission body reads also contributed to elapsed time. The trace does not locate every wait in C30.

## Decision

Only the historical-preparation composition creates a fresh read-only reader for its invocation. It shares each Blob observation through a local promise keyed by Blob ID, then passes this reader to snapshot verification and physical execution-fingerprint reconstruction. Blob data are immutable. Both consumers still check their expected identities, sizes, snapshot text and SHA-256; a shared download is not a shared Boolean verification result. Source-Mission before/after reads, source commitments, historical namespace checks, body consent and safe projection remain unchanged.

The reader exposes only `get`, has no shared/module cache and performs no lookup until an actual historical file is needed. A later preparation re-reads storage, including after a missing-file result. It does not claim continuous remote-object immutability between observations. Ordinary Experiment/Hidden/final callers retain fresh default storage reads; no cache is shared across assessments, executions, Missions or later planning operations.

This is application I/O composition through the existing Artifact port. Contracts/Core/Harness, provider inputs, source/evidence identities, budgets, deadlines, retry limits and acceptance gates do not change. No database, SDK, key, authorization, infrastructure or architecture exception is introduced.

## Verification and limits

Local tests first reproduced two downloads for one frozen file. Follow-up tests prove one read per physical file in one preparation, two source-Mission reads, rejection of a later same-size mutation, recovery from a missing file on a later fresh call, no I/O without historical sources, and verification against the supplied physical reader without falling back to another store.

The same real source-bound preparation then made six HTTP reads, with one Candidate download and one Original download. Its exact 142,406-byte context retained SHA-256 `bd23ae133230fce193d70bcabc835721290fa5ad0df7c9212acb2ecce06cc056`. All reads were HTTP 200. The second observed preparation time was 24.996 seconds, but uncontrolled network variation prevents attributing that latency difference to this change. The reduction in duplicate requests and unchanged context are the verified results. Both traces made zero model, execution or write calls and preserved C30's formal state.

This does not establish an accepted SOP, actual task cost, real user benefit or causal Lesson transfer. Those retain their independent requirements and evidence.

Final engineering verification passes 241 related tests across 14 files, all 11 Runner tests, architecture/changed-file lint and the full TypeScript/production build. The regression scope includes existing text/Office materialization, frozen-file identity, historical qualification, ordinary Hidden/final recovery and delivery.
