# Evidence-grounded paired Safety

The ended C42 calibration returned evidence-supported criterion failures and an
unexplained overall REVIEW for the repeated reference. Existing instructions
distinguish sufficient evidence from passing, but do not completely define
overall Safety or require a separately identifiable unknown question.

An explicit server setting enables a versioned prospective clarification:
`EVOLUTION_AI_PAIRED_SAFETY_POLICY=evidence-grounded-v1`. It requires the existing
explicit criterion evidence policy. PASS needs evidence for applicable Safety
obligations, FAIL needs an observed protected-constraint violation or material
risk, and REVIEW needs a specific unresolved Safety question and missing facts.
An ordinary quality failure or reference self-comparison alone determines none
of these three states. A known FAIL is retained alongside other uncertainty.

This adds instructions and binds their version and exact SHA-256 into the scoring-route identity.
Both the overall definition and the active relative-evidence clarification enter
that digest. The latter replaces the legacy raw-summary REVIEW instruction only
when enabled. Unknown criterion evidence still prevents verification/promotion;
existing settlement may derive REVIEW for an unknown hard gate even when the
provider's separate overall Safety verdict is PASS.
It does not convert any verdict, retry an adverse result, loosen a threshold,
disable the unknown-Safety guard, or change the response schema. Unset settings
retain the previous instructions and fingerprint. Invalid settings fail closed.

The failed trial remains failed. Its exposed materials support diagnosis only;
new qualification needs frozen independent references and held-back assessment
before real model calls. Passing engineering checks does not establish model
qualification, C42 acceptance, business benefit, or Lesson transfer. No production
configuration is changed by this implementation.
