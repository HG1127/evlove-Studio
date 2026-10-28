# Recover a committed Plan after a settled Baseline failure

Date: 2026-10-28

Status: accepted mechanism; no new real acceptance or business result established.

## Observed limitation

The planning-preservation change fixes the successful refresh observed in C26. Local fault injection found a further gap: after a Judge rejected a refresh, the persisted Baseline became failed and the stage became baseline. The next admission required a ready prior Baseline, so the unchanged committed Plan could never recover. This is a locally reproduced recovery defect, not an assertion that C26 had this additional failure.

Response-body fault injection also found that the direct AI gateway swallowed an interrupted body as an empty JSON object. That loses the transport failure and can invoke the existing format-correction generation while the first remote outcome is unknown.

## Decision

Contracts adds an optional, strict `planned-baseline-refresh-v1` continuation. It binds the Mission, original Plan checkpoint, round, selected complete queued Candidates, final-paper hash, Original physical references, scoring identity, approval, failure-memory sources, policy and original budgets. Legacy records do not gain a default continuation or change their canonical bytes.

Harness admits a persisted retry only after a known finished rejection or completely received invalid model reply, under the same fingerprint and original active limits. It retains the physical Original binding even when a failed measurement has no current references. A successful fresh measurement clears the continuation and hands the original Plan to Experiment. Running, orphaned, modified, expired or uncertain attempts stop before external work. Pending continuations cannot reuse otherwise positive scores as a passing Baseline.

Timeouts, connection failures, unknown errors and ambiguous upstream HTTP failures are `unsettled`, not retry permission. Native HTML collection exposes caught execution failures to this explicit recovery observer; an uncertain native or external execution stops subsequent semantic/Judge calls. Existing callers retain their compatibility behavior. An unsettled receipt requires separate authoritative reconciliation; this change does not invent completion or automatically reopen it.

The application usage adapter fully reads a provider response before parsing its JSON. A body-read failure records a transport observation with unknown token/billing coverage and propagates the original error without format correction. A fully received malformed envelope can use the existing single format correction. HTTP rejection semantics, credential redaction and usage-start persistence remain enforced. No new provider, dependency, purchase, retry allowance, deadline, freshness limit or acceptance threshold is introduced.

## Verification and limits

Tests cover persisted rejection/recovery, all continuation bindings, Original retention, stale limits, positive-score reuse prevention and native/external/semantic/Judge uncertainty. Response-stream tests cover both direct protocols, complete malformed envelopes, exactly one request on body timeout, matched usage records and exclusion of credentials/content.

The final related regression set passes 445 tests across 39 files, including all Contracts tests; all 11 Runner tests, architecture/changed-file lint and the full production TypeScript/build check pass. Earlier failing fault-injection runs remain retained.

Source-bound local replay on actual C26 revision 5/6 states injects a hypothetical terminal HTTP 429 rejection, persists/reparses it and selects Experiment with the same Candidate, paper, Original and zero new generations. The original expired window is rejected. All C23–C26 terminal canonical hashes remain unchanged. This replay makes zero model requests, isolated executions or remote writes and does not revise any historical trial verdict.

This follows the mandatory Contracts/Core/Harness/application dependency direction and preserves all 23-node identity/evidence requirements. It is not a stack or architecture exception. A future real confirmation is still needed, followed separately by independent business observations and causal unseen-task transfer.
