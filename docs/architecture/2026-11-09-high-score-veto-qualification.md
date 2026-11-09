# High-score negative verdict qualification

Status: accepted local repair; no new model qualification or production deployment.

A paired criterion can return a score at or above its issued minimum with `pass=false`. A nonempty free-text gap does not establish that a required clause is actually unmet: it can even affirm acceptance. Core cannot resolve that semantic question from string syntax.

Under `high-score-rejection-review-v1`, Safety PASS / sufficient-evidence high-score negatives require independent adjudication regardless of gap text. The runtime journals the original response first, then raises a non-retryable review-required error. It does not change the score, boolean, reasons, other known negatives or Safety. This can also hold a legitimate veto; the error describes unresolved measurement qualification, not a proven artifact defect. Missing evidence and known Safety FAIL retain their existing paths. No override, adjudicator, extra model call, correction or retry is added.

The pure Core predicate is consumed by the existing backend judge. The public syntax-only helper remains for compatibility and explicitly cannot establish a semantic veto. The previous error class name remains an alias; the new error code identifies review rather than malformed output.

The paired scoring fingerprint includes this consumption policy, invalidating old paired calibration/admission/replay identities. Ordinary Baseline measurement identity and every model request byte remain unchanged. Archived results, original criteria, thresholds, controls and independent-final questions are not rewritten. This repair prevents unqualified consumption; it does not prove model correctness, SOP acceptance, business benefit or autonomous evolution.
