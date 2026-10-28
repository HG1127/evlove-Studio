# Recover a committed Plan after a settled Baseline failure

Date: 2026-10-28

Status: accepted mechanism; no new real acceptance or business result established.

## Observed limitation

The planning-preservation change fixes the successful refresh observed in C26. Local fault injection found a further gap: after a Judge rejected a refresh, the persisted Baseline became failed and the stage became baseline. The next admission required a ready prior Baseline, so the unchanged committed Plan could never recover. This is a locally reproduced recovery defect, not an assertion that C26 had this additional failure.

Response-body fault injection also found that the direct AI gateway swallowed an interrupted body as an empty JSON object. That loses the transport failure and can invoke the existing format-correction generation while the first remote outcome is unknown.

## Decision

Contracts adds an optional, strict `planned-baseline-refresh-v1` continuation. It binds the Mission, original Plan checkpoint, round, selected complete unexecuted Candidates, final-paper hash, Original physical references, scoring identity, approval, failure-memory sources, policy and original budgets. Legacy records do not gain a default continuation or change their canonical bytes.

Harness admits a persisted retry only after a known finished rejection or completely received invalid model reply, under the same fingerprint and original active limits. It retains the physical Original binding even when a failed measurement has no current references. A successful fresh measurement clears the continuation and hands the original Plan to Experiment. Running, orphaned, modified, expired or uncertain attempts stop before external work. Pending continuations cannot reuse otherwise positive scores as a passing Baseline.

Timeouts, connection failures, unknown errors and ambiguous upstream HTTP failures are `unsettled`, not retry permission. Native HTML collection exposes caught execution failures to this explicit recovery observer; an uncertain native or external execution stops subsequent semantic/Judge calls. Existing callers retain their compatibility behavior. An unsettled receipt requires separate authoritative reconciliation; this change does not invent completion or automatically reopen it.

The application usage adapter fully reads a provider response before parsing its JSON. A body-read failure records a transport observation with unknown token/billing coverage and propagates the original error without format correction. A fully received malformed envelope can use the existing single format correction. HTTP rejection semantics, credential redaction and usage-start persistence remain enforced. No new provider, dependency, purchase, retry allowance, deadline, freshness limit or acceptance threshold is introduced.

## Verification and limits

Tests cover persisted rejection/recovery, all continuation bindings, Original retention, stale limits, positive-score reuse prevention and native/external/semantic/Judge uncertainty. Response-stream tests cover both direct protocols, complete malformed envelopes, exactly one request on body timeout, matched usage records and exclusion of credentials/content.

The final related regression set passes 445 tests across 39 files, including all Contracts tests; all 11 Runner tests, architecture/changed-file lint and the full production TypeScript/build check pass. Earlier failing fault-injection runs remain retained.

Source-bound local replay on actual C26 revision 5/6 states injects a hypothetical terminal HTTP 429 rejection, persists/reparses it and selects Experiment with the same Candidate, paper, Original and zero new generations. The original expired window is rejected. All C23–C26 terminal canonical hashes remain unchanged. This replay makes zero model requests, isolated executions or remote writes and does not revise any historical trial verdict.

This follows the mandatory Contracts/Core/Harness/application dependency direction and preserves all 23-node identity/evidence requirements. It is not a stack or architecture exception. A future real confirmation is still needed, followed separately by independent business observations and causal unseen-task transfer.

## C27: preserve legitimate drafts as well as queued proposals

The real confirmation using pushed `d4dc924` produced `CAND-CONFIG-SPEC-ALL-01` in the contract's valid default `draft` status, with Experiment Ready approved and the original independent paper bound. It had no frozen files or execution records. At `2026-10-28T12:49:44.755Z`, the queued-only refresh admission rejected it before fresh measurement. The terminal Workflow is completed with a waiting Job; no continuation, Candidate construction, final assessment or delivery occurred.

Refresh admission now accepts both unexecuted `draft` and `queued` proposals. This is compatibility with the existing Candidate contract and committed Plan, not permission to resume running, failed, passed or winning Candidates. Selection, approval, paper, Original, failure-memory, fingerprint and budget checks remain unchanged. Tests exercise fresh measurement and direct Experiment handoff for each legitimate status and reject the other lifecycle states.

Local replay of the actual C27 Plan isolates this defect: `d4dc924` rejects it, while the changed admission recognizes the same Candidate/checkpoint/Original/paper under the original window. It neither retries the real measurement nor modifies formal terminal SHA-256 `aa99d1dc434aa86ffbc547f1dda415b4638268d09612359f00331b8fa12418b2`. Five actual MiniMax requests all settled before the owned backend stopped; the three real-effect claims remain unmet.

The draft follow-up passes 253 related tests across 13 files, all 11 Runner tests, architecture/changed-file lint and the complete TypeScript/production build. The original failing draft regression is retained. No new real confirmation has exercised the changed admission through a fresh measurement and accepted delivery.

## C28: actual approved-draft refresh, still no accepted delivery

C28 using `3025eea` now provides real successful refresh evidence. Draft `candidate-P001-execution-contract-01` qualified at a prior observation age of 913,768 ms. Fresh measurement completed at `2026-10-28T13:33:05.637Z`, preserving the exact Candidate, Plan checkpoint, Original references, final paper `348b34af-6278` and all budgets, then clearing the continuation. The only model operations during refresh were two evaluations; no new analysis, diagnosis, plan or construction was invoked.

The original 30-minute timer cancelled the bound Workflow/Job 20 seconds later, before construction. Formal Mission SHA-256 is `e232f967ca32a211dd351e9207d5ae6e0c2cf25d7f192488aa66f19815e67230`. Signed diagnostic Artifact `sop-confirm28-refresh-c4e87dda709b57bb030a6ab8` retains exact readback SHA-256 `c4e87dda709b57bb030a6ab8f204eed0332d229f0bd700c77a1e7eb6bf4c6c3d` without changing that state or any acceptance result. This establishes actual successful refresh of a legitimate draft, not accepted construction, real business benefit or causal transfer.
