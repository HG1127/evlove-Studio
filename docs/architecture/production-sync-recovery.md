# Complete Mission reads after a database query timeout

The production workspace contains full versioned Mission envelopes. Reducing a
page must not turn them into summaries, remove artifact/evidence fields, change
revisions, or imply that a short page ends the collection.

The REST boundary recognizes the structured PostgreSQL `57014` code returned
with HTTP 500. It exposes only that code and the existing public timeout reason,
never the upstream SQL message. It does not repeat that same oversized query.
Other transient read failures retain their existing bounded reconnection policy;
ambiguous writes are never replayed.

The Mission collection reader retries a confirmed statement timeout at the same
cursor with smaller row limits: 10 → 5 → 2 → 1. It stops if one row still fails,
or if any other failure occurs. A successful smaller page retains complete rows
and advances to its actual last ID. Clients continue until an empty page; the
Job pagination policy is unchanged.

The workbench treats remote totals as unknown until synchronization succeeds.
During a connection failure it can show previous cached tasks, clearly labelled,
but does not report zero tasks or claim that unattended work is progressing.

The temporary protected-deployment identity bridge is a fallback. An existing
verified browser session keeps its own role and same-origin checks. An explicit
invalid signed actor assertion cannot fall back to that bridge.

Local recovery tests and browser fixtures do not establish production recovery.
A release still requires complete real cursor traversal, schema validation and
preserved model configuration on the staged production build before promotion.
