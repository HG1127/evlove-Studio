# Saved backend model roles

The default `ai-connection` API continues to configure generation. An optional
`role=judge` query configures scoring and acceptance independently. Both routes
retain the existing administrator permission, HTTPS validation and encrypted
Vault storage. Public status responses contain settings and a revision, never
the provider key. No database migration is required.

Judging covers `evaluate`, `evaluate-paired`, `evaluate-population`,
`artifact-acceptance`, `release-review` and `visual-judge`. A request-local
snapshot pins both connections before work. A configured judge that cannot be
read stops the work instead of silently using the generator. An absent optional
judge preserves the legacy generation default. Explicit draft probes remain
isolated from saved connections and do not save configuration.

Scoring fingerprints and physical request journals use the effective judge
route. Changing only the generator does not change the scoring identity.
Saving or probing a judge does not establish independent acceptance eligibility:
the unchanged calibration and artifact-bound evidence gates still apply.

The browser confirms each successful save with an uncached GET of the same role.
Its settings and persisted revision must match the write receipt. A failed or
conflicting readback is reported as unconfirmed without replaying the write.
Late initial reads cannot overwrite a newer confirmed save. Each role also has a
read-only refresh action.

Project/task projection health is separate from model persistence. Full Mission
envelopes can be large, so browser and server Mission pages are capped at ten
rows and continue until the cursor ends. Jobs retain their existing page size.
No artifact, evidence or state fields are removed. Public data-service errors
identify the affected collection and translate validated failure reasons;
internal causes and raw upstream responses are not exposed.
