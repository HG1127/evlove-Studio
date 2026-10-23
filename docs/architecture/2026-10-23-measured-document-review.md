# Reuse complete measured document observations in independent review

Status: implemented for validation, 2026-10-23.

The first real frozen SOP Candidate was rejected by the independent Judge. Its execution records retained complete document text, but the Judge saw only 6,000-character excerpts and no measured current Baseline counterpart. Some reported deficiencies described missing review input rather than measured defects. No accepted delivery resulted.

Harness now provides a bounded, deduplicated set of the already collected complete document observations alongside existing per-case excerpts. The Candidate Judge receives existing Candidate and current Baseline observations; the Hidden current-version Judge receives its own observations. Only verified direct document-read observations with matching runtime trace identities qualify. An oversized observation is omitted explicitly, never cut and presented as complete. These are observations, not passing verdicts. Original scope, thresholds, independent final reservation, browser requirements and delivery identity are unchanged.

The review helper has access only to execution records. It does not read Source Artifacts, frozen HTML, scripts, styles, controls or structure snippets. It does not add a model destination or provider. Automatic approval rejected the earlier proposed raw-snapshot context construction because it could expand sensitive source egress; this decision uses the approved safer alternative of existing measured projections.

Assessment results carry a runtime-owned review-policy version. Legacy semantic assessments must be independently reviewed again before Holdout reuse; valid recent raw observations may still be retained under the existing physical binding and age checks. Experiment observation fingerprints include the new review policy. The already complete primary Original Baseline measurement policy stays unchanged, so this assessment repair does not reset search history or mint a replacement Original score.

Remaining limits are explicit: document text does not prove browser behavior, visual fidelity, complete CSS/JavaScript preservation, real operational benefit or learning transfer. The historical failed assessment and first frozen Candidate remain preserved, rather than rewritten into a success.
