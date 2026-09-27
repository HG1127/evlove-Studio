import { describe, expect, it } from "vitest";
import type { EvaluationResult, EvolveProject } from "@evolution/contracts";
import { campaignLiveObservationFresh, LIVE_TARGET_OBSERVATION_MAX_AGE_MS, campaignRootBaselineForMeasurement, campaignScoringInputBlocker, campaignScoringInputFingerprint } from "./campaign-scoring-input";

function project(): EvolveProject {
  return {
    goal: "Improve the Target",
    evolutionCommand: "Preserve facts",
    acceptanceRubric: [{ id: "REQ", requirement: "Complete answer" }],
    evalSuite: [{ id: "visible", input: "question", expected: ["answer"] }],
    hiddenEvalSuite: [{ id: "hidden", input: "blind", expected: ["proof"] }],
    metrics: [{ key: "quality", target: 90, direction: "higher" }],
    protectedItems: ["facts"],
    inputClarifications: [],
    targetConnection: { adapter: "artifact", connectionId: "source" },
    sourceArtifacts: [{ id: "source", role: "target", textContent: "original", structure: [], size: 8 }],
    campaign: { currentRound: 1 },
  } as unknown as EvolveProject;
}

describe("Campaign scoring input identity", () => {
  it("remains stable as Champion or display version changes", () => {
    const original = project();
    const fingerprint = campaignScoringInputFingerprint(original);
    expect(campaignScoringInputFingerprint({ ...original, version: "V2" })).toBe(fingerprint);
    expect(campaignScoringInputFingerprint({ ...original, targetConnection: { ...original.targetConnection, status: "error", label: "Renamed" } })).toBe(fingerprint);
    const snapshotted = { ...original, targetConnection: { ...original.targetConnection, gitSnapshot: { commitSha: 'abcdef1', treeSha: 'abcdef2', artifactId: 'source', observedAt: '2026-09-01T00:00:00Z' } } };
    const snapshotFingerprint = campaignScoringInputFingerprint(snapshotted);
    expect(campaignScoringInputFingerprint({ ...snapshotted, targetConnection: { ...snapshotted.targetConnection, gitSnapshot: { ...snapshotted.targetConnection.gitSnapshot, observedAt: '2026-09-02T00:00:00Z' } } })).toBe(snapshotFingerprint);
    expect(campaignScoringInputFingerprint({
      ...original,
      searchChampion: { id: "new-champion" } as EvolveProject["searchChampion"],
    })).toBe(fingerprint);
  });

  it("changes with the goal, suite, rubric, or original Target", () => {
    const original = project();
    const fingerprint = campaignScoringInputFingerprint(original);
    expect(campaignScoringInputFingerprint({ ...original, goal: "New goal" })).not.toBe(fingerprint);
    expect(campaignScoringInputFingerprint({ ...original, targetConnection: { ...original.targetConnection, connectionId: "replacement" } })).not.toBe(fingerprint);
    expect(campaignScoringInputFingerprint({ ...original, hiddenEvalSuite: [{ ...original.hiddenEvalSuite[0]!, input: "new blind" }] })).not.toBe(fingerprint);
    expect(campaignScoringInputFingerprint({ ...original, acceptanceRubric: [{ ...original.acceptanceRubric[0]!, requirement: "New rule" }] })).not.toBe(fingerprint);
    expect(campaignScoringInputFingerprint({ ...original, sourceArtifacts: [{ ...original.sourceArtifacts[0]!, textContent: "changed" }] })).not.toBe(fingerprint);
    expect(campaignScoringInputFingerprint({ ...original, sourceArtifacts: [{ ...original.sourceArtifacts[0]!, name: "renamed.md" }] })).not.toBe(fingerprint);
    expect(campaignScoringInputFingerprint({ ...original, experimentPolicy: { ...original.experimentPolicy, batchSize: 2 } })).not.toBe(fingerprint);
  });

  it("reanchors only the first round after a changed contract and preserves the root on later retries", () => {
    const original = project();
    const root = { accuracy: 50 } as EvaluationResult;
    const measured = { accuracy: 80 } as EvaluationResult;
    const firstRound = {
      ...original,
      campaign: {
        ...original.campaign,
        currentRound: 0,
        rootBaseline: root,
        scoringInputFingerprint: campaignScoringInputFingerprint(original),
        scoringRouteFingerprint: "route-a",
      },
    };
    expect(campaignRootBaselineForMeasurement(firstRound, measured, "route-a")).toBe(root);
    expect(campaignRootBaselineForMeasurement(firstRound, measured, "route-b")).toBe(measured);
    expect(campaignRootBaselineForMeasurement({ ...firstRound, goal: "Changed goal" }, measured, "route-a")).toBe(measured);
    expect(campaignRootBaselineForMeasurement(firstRound, measured, "route-a", true)).toBe(measured);
    expect(campaignRootBaselineForMeasurement({
      ...firstRound,
      campaign: { ...firstRound.campaign, currentRound: 1 },
    }, measured, "route-a", true)).toBe(root);
  });
  it("expires same-round live observations after ten minutes while static evidence remains reusable", () => {
    const original = project();
    const live = { ...original, targetConnection: { ...original.targetConnection, adapter: "http" as const } };
    const observedAt = "2026-09-28T00:00:00.000Z";
    const at = Date.parse(observedAt);
    expect(campaignLiveObservationFresh(live, observedAt, at + LIVE_TARGET_OBSERVATION_MAX_AGE_MS - 1)).toBe(true);
    expect(campaignLiveObservationFresh(live, observedAt, at + LIVE_TARGET_OBSERVATION_MAX_AGE_MS)).toBe(false);
    expect(campaignLiveObservationFresh(live, undefined, at)).toBe(false);
    expect(campaignLiveObservationFresh(live, observedAt, at - 1)).toBe(false);
    expect(campaignLiveObservationFresh(original, undefined, at)).toBe(true);
  });
  it("pauses old scored rounds but allows an unscored first round", () => {
    const original = project();
    const fingerprint = campaignScoringInputFingerprint(original);
    const measured = { ...original, campaign: { ...original.campaign, scoringInputFingerprint: fingerprint } };
    expect(campaignScoringInputBlocker(measured)).toBeUndefined();
    expect(campaignScoringInputBlocker({ ...measured, goal: "New goal" })).toContain("重置搜索");
    expect(campaignScoringInputBlocker({ ...measured, campaign: { ...measured.campaign, scoringInputFingerprint: undefined } })).toContain("重置搜索");
    expect(campaignScoringInputBlocker({ ...measured, campaign: { ...measured.campaign, currentRound: 0 } })).toBeUndefined();
  });
});
