# Native artifact task outcomes

Native file outcomes use original and accepted byte identities. They never fabricate website deployment IDs or reinterpret the deployment-bound Outcome v1 path. The original minimum of 30 tasks per arm, acceptance of at least 80%, median time at most 80% of baseline, and no increase in cost per accepted task remain unchanged.

The backend must first render the exact accepted package. A versioned artifact-outcome-study-v1 policy binds its Mission, Candidate, acceptance ID, evidence fingerprint, complete original and accepted Artifact references, registration time, and fixed task IDs. Both arms are read through the workspace private Artifact store and checked by size and SHA-256 before collection and analysis. A study supports 30–150 tasks per arm.

Configure EVOLUTION_ARTIFACT_OUTCOME_STUDIES_JSON only after an accepted package and a real source exist. It is an array of objects with study, urlTemplate, optional authEnv, and optional timeoutMs (500–30000). The HTTPS URL must contain {arm} and may also contain {missionId} and {studyId}. Credentials belong in the named server environment variable. No source is configured by default.

Each arm returns a JSON object with schemaVersion artifact-task-records-v1 and a records array. Each record contains only taskId, observedAt, artifacts (sourceArtifactId, blobId, sha256, sizeBytes), accepted (boolean), elapsedMs, actualCost, and currency. Unknown cost cannot be entered as zero. Do not send personal identifiers. Task identity alone cannot prove different humans participated or that invoices exist.

POST /api/evolution/artifact-outcome-collect with {missionId,studyId} requires outcome.write. It reads complete responses from both arms before ingestion. Source GETs reconnect once on a known network failure or 429/5xx. Malformed complete responses are not retried; responses over 5 MiB fail without truncation. Identical replays are idempotent. Contradictory valid source reports remain as conflicting observations and cannot silently replace the first report or select the better value.

GET /api/evolution/artifact-outcome-analysis?missionId=...&studyId=... requires data.read. It checks the accepted package and physical byte custody again, reads complete warehouse observations, and applies the shared numeric gates. A missing failed attempt keeps the full planned denominator and leaves evidence insufficient.

Samples use the existing private Outcome warehouse and a versioned native subject in JSON metadata; no database migration is required. The source namespace is outcome-telemetry:artifact-study.<study-id>. Changing a frozen study requires a new study ID. Existing website collection, statistics, release gates, and Skill promotion rules are unchanged.

Numeric thresholds never certify real human tasks, consent, randomization, actual billing, causal benefit, Lesson transfer, or full SOP evolution. Both establishesCausalBenefit and establishesRealUserBenefit remain false. Those claims require separate real evidence. All test fixtures are synthetic and are never enrollment or production observations.
