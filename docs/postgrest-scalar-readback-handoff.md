# PostgREST scalar readback recovery

## Actual failure and scope (2026-10-12)

Real Mission `project-1790480873333` started through the governed production API after the operator/Vault recovery and a successful production-native MiniMax structured-output health check. The served source was `2ea17671ce939c5dfa398b5907bb9c8ae907b263`. Run `wrun_01M4QK7AGE9V35FWRABM6T5W56` failed in `initializeWorkflowControlStep`; its Control Job `workflow-control-069915b2-be33-414c-a93a-1d99a5862a4f` remained running. Experiment, paired Hidden, Gate F and accepted download/reopen did not execute. Do not interpret the stale Job label as a live Run.

The initializer inserted Event `evt-workflow-control-069915b2-be33-414c-a93a-1d99a5862a4f-started` but then threw `Persisted Event could not be read back`. Production read-only comparison at 08:45 UTC found one row using the literal scalar ID, zero using an added quoted ID. Mission filtering similarly returned five rows versus zero. No RLS/schema change is needed to fix this reproduced query error.

## Repair

Standalone PostgREST scalar filters consume the decoded value literally. URI encoding preserves its existing punctuation/quotes without adding grammar quotes. Nested `or/and` expressions retain their existing escaping and quotes. A small backend helper makes those two contexts explicit.

Eight scalar call sites in six infrastructure services change: Event exact identity and Mission pages; Evidence exact identity and Event scan pages; active Job Mission scope; Parse recovery session scope and timestamp lower bound. Event canonical identity, timestamp precision, duplicate conflict detection, signed Evidence retry verification, row scope checks and cursor advancement stay enforced. The `in` list and nested cursors in Outcome sampling remain unchanged. Candidate and Gate F Domain logic is untouched.

## Evidence and limits

- Before repair: nine files, 83 tests, 23 failed. Retained `postgrest-scalar-before-repair-20261012.json` and `.log` under `D:/Downloads/evolution-os-smoke-temp`.
- Final focused regression: 14 unique files, 154 passed, zero failed/skipped. `postgrest-scalar-final-regression-20261012.json` and `.log`. Tests exercise an inserted Event lookup, replay and conflicting identity, signed mirror lost-response recovery, punctuation/query delimiters, literal Mission/session values, and unchanged nested/in syntax.
- Architecture, complete lint and production build exit zero. `postgrest-scalar-local-gates-20261012.json` and per-stage logs. Tests/build use a credential-free child environment and one worker.
- Repaired application functions against the real production database, read-only: exact Event found, three Mission rows, three nested-cursor rows and three scalar-cursor rows. Four HTTP 200 requests, no writes/provider requests. `postgrest-scalar-real-readback-20261012.json` records the exact local source hashes and explicitly excludes deployed-code proof.
- Official reference: [scalar client implementation](https://raw.githubusercontent.com/supabase/supabase-js/master/packages/core/postgrest-js/src/PostgrestFilterBuilder.ts), [PostgREST grammar contexts](https://docs.postgrest.org/en/stable/references/api/url_grammar.html). Supabase changelog and observability guidance were read before the repair.

The dedicated CI/Git chats must complete the exact-commit Quality Gate and deploy/verify the exact served SHA. Current checks do not restart or repair the failed Run/Job and do not prove real Mission acceptance. A normal product retry must separately account for the failed SDK Run and its stable request key; returning a reused queued acknowledgement is not execution proof.

## Runtime approvals and accepted-file boundary

The owner explicitly approved production access/model-storage recovery, use of the saved MiniMax credential for health checks, and real Mission file cloud execution on 2026-10-12. These are no longer pending. Production-native `chat-completions` with `json-schema` passed and the same saved MiniMax connection was verified at revision 2; failed JSON-object and Responses probes are retained separately. No Gateway is required.

Physical preflight reads verified the original SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a` (264173 bytes) and changed frozen `cand-P1-001` SHA-256 `9a616d1a919e18f6f6e606cee02ca9f9617e680c2875bf888fca07f8e863f068` (271574 bytes). Those are preflight file observations, not accepted delivery. Fresh execution receipts, same-paper paired Hidden, Gate F and identical accepted downloaded/reopened bytes remain required. No manual Cron, Job repair, blob cleanup or migration is authorized by the three approvals.
