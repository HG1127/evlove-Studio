# Human-reviewed fixed-file Hidden continuation

## Approved real record

Mission: project-main-flow-sop-b2663c8f-f695-436a-a219-691ff27fe273.

- Original SHA-256: 6605429efe92470229601adfb3196bc74ae38855f55d71c8754f8336c52b580a (264173 bytes).
- Frozen winner: P1-03, SHA-256 f8474fe20061abd778e0546585bebeabe8d6df8abeba29e0c9a1a10a06d3c106 (268204 bytes).
- Original Baseline baseline-server-1792049734524: valid Safety REVIEW, retained.
- Prior failed Hidden: validation-server-r1; raw same-paper executions retained, independent JSON assessments incomplete.
- Production evidence collected under e63c0f396022beab4be42a7acb91fe7d032cef71; this new continuation feature is not proved deployed by that SHA.

The human approved “批准人工复核继续，保留 REVIEW”. Bound approval and original report hashes are in D:/Downloads/evolution-os-smoke-temp/server-ai-selection-20261014/sop-new-mission-authorized-20261015/reviewed-holdout-human-authorization-20261015.json.

## Operator path

1. In the Mission flow, choose “读取当前复核信息”. This is read-only and verifies actual Original/frozen bytes.
2. Read the retained REVIEW reasons and exact Candidate SHA. Enter the human review explanation and acknowledge preserving REVIEW/history and all acceptance gates.
3. Confirm once. The dedicated endpoint creates one normal governed Campaign Job and SDK Run. A lost response must use the same request key; do not create speculative duplicate runs.
4. Inspect actual Run/Job status. A terminal SDK Run with a waiting Job is paused, not live.
5. The Workflow executes fresh Current/Candidate Hidden arms on the unchanged paper. A valid REVIEW/FAIL pauses and is retained. Invalid or incomplete evidence cannot become PASS.
6. Only a fresh eligible pair permits the existing Gate F, with repairs disabled to preserve the exact approved Candidate.
7. If Gate F passes, separately download and reopen the accepted frozen file. Record the downloaded SHA-256 and compare it to the accepted receipt. A prior frozen readback is not an accepted download.

GET /api/evolution/reviewed-holdout?missionId=... returns a strict preview. POST to the same path requires its exact binding, stable idempotencyKey, humanReviewNote, preserveReview=true and preserveAcceptanceGates=true. The normal /start route grants none of this authority.

See [ADR 0002](architecture/0002-human-reviewed-isolated-holdout.md). Implementation tests and build evidence are necessary code checks; they do not complete this real Mission or authorize production release.
