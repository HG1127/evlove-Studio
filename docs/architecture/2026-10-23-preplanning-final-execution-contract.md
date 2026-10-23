# Independent final papers bind execution capabilities before planning

Status: implemented for validation, 2026-10-23.

The real HTML pilot reserved an independent paper, then timed out during planning. That unexecuted paper also requested an unbound human trial and real configuration/fault injection although the workflow-closure criterion explicitly limits evidence to written document contents. Its visual case had no browser steps. The model-facing test schema could not express browser steps at all. None of these conditions proves a product failure or improvement.

## Decision

The backend describes its bound execution ports to Harness through a versioned contract. For the current HTML path these include document observation, native/static checks, roundtrip and Sandbox DOM assertions. A browser case must include an assertion with valid operands. A human trial or a fully verified visual review cannot be advertised without its corresponding port. All original criteria, thresholds and protected scope remain required. If they genuinely require an absent capability, generation must stop rather than reinterpret them as weaker static tests.

The model-facing schema includes browser steps, and paper generation is restricted to the fixed Original/rubric and existing source payload. No extra HTML controls, structure fragments or other source enrichment are transmitted. The mutator receives neither active nor historical final papers. Diagnosis and Baseline failures are removed from paper-generation context. Only `hiddenCases` becomes this paper; unused visible cases cannot satisfy its coverage. Core reports the exact missing Criterion IDs and identity/clone/execution violations. Harness permits one correction of an unreserved paper from the same Original and unchanged rubric. Provider failures, executed final-test feedback and Candidate results cannot enter that retry path. It cannot trim cases or relabel them as verified.

The reservation records an execution-contract fingerprint. Before any persisted Candidate or Candidate feedback in that round, a stale reservation may be superseded before a new planning invocation. The old paper is retained in server-owned history and excluded from future paper reuse. This handles a failed planning call without erasing its failed attempt. Once any Candidate, experiment/validation result or acceptance attempt exists, same-round replacement is forbidden. A final-paper product failure still cannot drive targeted repair. A new round keeps the previous reservation as history.

The actual fourth attempt, including its legacy paper and timeout, remains failed. A later accepted Candidate must bind the newly reserved paper and its exact frozen bytes; it cannot retroactively validate that failed attempt.

## Layering and recovery

Contracts own schemas; Core owns execution compatibility, paper identity and replacement eligibility; Harness owns reservation sequencing; backend composition supplies actual port capabilities. Generic Mission PUT cannot mint or rewrite active or historical reservations. The configured AI timeout is read independently of environment API keys so an encrypted user-selected connection respects the same bounded 10–300 second policy. Recovery does not reset campaign time/cost budgets or alter scoring requirements.
