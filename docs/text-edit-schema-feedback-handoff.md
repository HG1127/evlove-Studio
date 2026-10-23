# Candidate text edit schema feedback handoff — 2026-10-20

## Actual Mission evidence

Production `91a661438bb7db60df69901eabcb5aa137e8d3e0` served the same authorized Mission `project-main-flow-sop-fields-7ba9c02b-0ffc-48bc-b109-101592ae0d14`. The original Artifact is `artifact-5e58fc69-2bec-4cd5-92a7-9964faf40b82`, 264173 bytes, SHA-256 `6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a`.

The one normal retry started Run `wrun_01M59P56XP19M94NAKDT792YCK`, Job `workflow-control-6ca1993e-15b5-4550-b5c7-cc9c2fe08e74`. It retained prior failed Jobs and recovery ownership evidence. Refreshed real Baseline `baseline-server-1792400369038` completed with rubric 75, Safety PASS and verified rubric coverage 90. Diagnosis and the five-Candidate Plan completed. These results do not establish complete HTML protection: the protect-all case remains UNVERIFIED with a collection capability gap.

The authoritative 2026-10-20T00:37:20.799Z read is Mission revision 32, SDK completed, stored Job waiting, Campaign paused and Experiment failed. No active execution or frozen Candidate exists.

| Candidate | Retained build failure |
| --- | --- |
| C-01 | Model response timeout |
| C-02 | Initial exact edit construction rejected; the one directed repair also rejected |
| C-03 | Model response timeout |
| C-04 | Initial exact edit construction rejected; directed repair exceeded confirmed existing card body text scope and freeze was refused |
| C-05 | Model response timeout |

Raw rejected provider outputs are unavailable. The actual invalid field in C-02 and the causes of the timeouts have not been established. Evidence is recorded in `D:/Downloads/evolution-os-smoke-temp/text-edits-feedback-20261020/real-terminal-build-failure.json`, SHA-256 `ce16f1920b1a079e04987543041b6486f9af25b3ad9055bab0e1b26f7ccad536`.

## Source change

The outer BuildCandidate contract permits `artifacts[].content` as a string. An invalid inner text edit object can therefore reach the strict construction validator, which reports a generic construction error. The existing one bounded construction repair receives that generic error and prior output.

At the AI request boundary, `build-candidate` now supplies the existing public `TextArtifactEditsSchema` as JSON Schema when a current Target requires text edits. It explicitly requires the entire supplied Candidate plan, exact before anchors, strict allowed fields and optional accurate offsets. Complete existing source context, Candidate, protection policy and previous output remain intact.

For the existing attempt 1 correction with failure code `text-edits`, prior matching-source output is checked against that same strict schema. Only safe field paths and Zod issue codes are added to the existing request. Unknown field names and rejected values are omitted from diagnostics; each artifact reports at most 16 issues with an explicit omitted count. Other operations and full-file-only inputs are unchanged.

This change does not loosen the parser or physical protection check, add a repair or provider request, create an Artifact, modify evaluator policy, change the model/credentials/timeout/budget, or replace acceptance evidence. Candidate/Experiment, Core/Harness construction and Gate F implementations are unchanged. No dependency update or architecture exception is required.

## Verification and remaining work

Two request regressions first failed against the unchanged gateway and then passed after the boundary change. The expanded 23-test suite passed, including complete context retention, strict missing/type/unknown field diagnostics, no private-field echo, optional offsets, immutable schema instances, exact source matching, one correction only, and physical scope refusal. The fixture provider is mocked; no real model request was made by these tests.

Related regression passed all 410 assertions in 24 files (maxWorkers=1); architecture check, full lint and the TypeScript/Vite production build all exited 0. Command receipts are saved under `D:/Downloads/evolution-os-smoke-temp/text-edits-feedback-20261020`. Exact final results and source SHA belong in the external development handoff. Complete CI, Git integration and any publication remain with their dedicated owners.

This is a reproduced request-guidance gap, not proof of the actual rejected C-02 field or a timeout fix. After an authorized exact production deployment, use normal same-Mission recovery eligibility and retain the earlier failures. A real changed frozen Candidate, Experiment execution, fresh same-Hidden Current/Candidate pair, Gate F and identical accepted download/reopen are all still required. The 92-point threshold, full original protection and outstanding UNVERIFIED obligations remain in force.