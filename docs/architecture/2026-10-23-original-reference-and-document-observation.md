# Initial Original references and complete document observations

Status: implemented for validation, 2026-10-23. This decision changes initial Baseline eligibility, not Candidate acceptance.

The real SOP run exposed two different unknowns. A complete document could show a missing retry explanation, yet an execution model labelled the absence as missing runtime proof. A preservation comparison also required an evolved counterpart before any Candidate existed. The resulting Baseline could neither diagnose a known document deficiency nor construct that counterpart.

## Decision

For a complete HTML document text projection read from actual current bytes, Harness may produce a direct document-read observation. Core's existing document-evidence eligibility still applies. The observation contains the full source hash and explicit script/style/visual/runtime exclusions. It contains no quality score or passing decision. The independent judge reads the same current content and decides whether the document meets each intrinsic requirement. Oversized, missing, duplicate or invalid context stays incomplete; actual browser/visual modes retain their real execution ports.

Before the first Candidate, a server may lock immutable Original bytes as a versioned `original-artifact-reference-v1` proof. The backend must compare physical bytes with Mission-bound Source metadata, including ID, SHA-256 and size. Core accepts exactly one matching proof for every scoped Target. Only the initial Baseline, with no Candidate or accepted Champion, may treat protected pairwise comparisons as reference-only. The same applies to source-understanding cross-artifact comparisons on a single-source artifact. Ordinary user quality requirements remain measurable and required.

These comparison criteria remain unaccepted/unverified in Baseline results. They are excluded from diagnostic failure selection so a missing future counterpart is not reported as a product defect. The proof and deferred IDs are stored with the Baseline and cannot be minted or changed through generic Mission PUT. The normal user reset may clear both only by replacing the measurement with a new, empty, idle Baseline ID, without results, observations, measurement fingerprint or execution timestamps. Source changes, later rounds and Candidate existence prevent issuing new initial-reference deferrals. A fresh measurement clears previous reference metadata before executing. The semantic policy version changes to prevent reuse of older measurements.

## Invariants

This is an explicit exception to requiring every future preservation comparison to be VERIFIED before initial Candidate construction. It does not waive any requirement from Experiment, ordinary Hidden, the pre-reserved independent final paper, Gate F, Champion selection, packaging or delivery. These stages still evaluate the original full rubric and exact frozen Artifact. Missing browser evidence still blocks Baseline, even when an Original reference is locked. Domain policy stays in Core, execution mechanics in Harness, and Supabase reads in backend composition. No new infrastructure or inward dependency is introduced.
