# Complete Mission reads after a database query timeout

The production workspace contains full versioned Mission envelopes. Reducing a
page must not turn them into summaries, remove artifact/evidence fields, change
revisions, or imply that a short page ends the collection.

The REST boundary recognizes the structured PostgreSQL `57014` code returned
with HTTP 500. It exposes only that code and the existing public timeout reason,
never the upstream SQL message. It does not repeat that same oversized query.
Other transient read failures retain their existing bounded reconnection policy;
ambiguous writes are never replayed.

PostgREST's structured HTTP 503 / `PGRST002` means its schema cache could not be
loaded. It uses the existing bounded read reconnection policy, including abort
and Retry-After handling. Text mentioning "schema cache" alone does not enable
retries, and missing table/function codes retain their permanent classification.
Persistent cache failures remain unavailable and cannot satisfy release checks.

Production measurements confirmed that even one complete Mission can exceed the
inherited eight-second REST query budget. Two migration-managed, service-role-only
SQL invoker functions read complete rows with a function-local 45-second budget:
`read_evolution_mission_envelope_page` returns at most two rows, and
`read_evolution_mission_envelope` returns at most one exact-ID row. Neither changes
the global/role timeout, write policy, stored content, revisions or public grants.
Both migrations must be applied before publishing the corresponding backend.

The backend retries a confirmed statement timeout at the same cursor with row
limits 2 → 1. It stops if one row still fails or any other failure occurs. An
exact-ID response must match both the requested ID and the payload identity.
A successful smaller page advances to its actual last ID. Clients continue until
an empty page; the Job pagination policy is unchanged.

The HTTP adapter also resumes an interrupted Mission page at its original cursor,
reducing the requested page size 10 → 5 → 2 → 1 for transport errors or validated
transient service failures. It retains earlier complete pages privately until the
whole list validates, and remembers a working smaller limit for that adapter's
lifetime. It never retries malformed JSON, contract failures, permanent settings
errors or writes. A failed full read cannot publish partial task totals.

The workbench treats remote totals as unknown until synchronization succeeds.
During a connection failure it can show previous cached tasks, clearly labelled,
but does not report zero tasks or claim that unattended work is progressing.

The temporary protected-deployment identity bridge is a fallback. An existing
verified browser session keeps its own role and same-origin checks. An explicit
invalid signed actor assertion cannot fall back to that bridge.

Local recovery tests and browser fixtures do not establish production recovery.
A release still requires complete real cursor traversal, schema validation and
preserved model configuration on the staged production build before promotion.
