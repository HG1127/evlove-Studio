# UX Guidelines · V2.2

1. **Input first.** The primary entry is upload/paste + evolution command, not an empty project form.
2. **Success must be visible before execution.** Intake shows the Project-specific Acceptance Rubric before project creation; Target Ready shows the editable Rubric again.
3. **One primary task per stage.** Default UI explains the current decision and the next safe action.
4. **Progressive disclosure.** Business conclusion first; Trace, Rubric evidence, patches and provider telemetry in expandable details.
5. **Gate reasons are explicit.** If Target/Experiment/Artifact/Release is blocked, show exactly which criterion/check blocks it.
6. **Generic metrics are diagnostics.** The UI emphasizes Rubric Score / hard criteria over generic Accuracy/Evidence/Risk when deciding success.
7. **Artifact quality is user-facing.** Users can see per-criterion Acceptance score, gaps, Repair attempts and whether the final downloadable artifact is the exact accepted snapshot.
8. **Latency is observable.** Long AI actions show stage/progress where possible; Settings exposes average/P95 latency, input size, cache and error/fallback telemetry.
9. **Do not hide real work.** Candidate×Test executions can legitimately take time; the UI should distinguish useful experiment work from avoidable duplicate calls.
10. **High-impact actions remain explicit.** Shadow, Canary, Promote and Rollback require deliberate user action.
