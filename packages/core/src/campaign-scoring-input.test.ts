import { describe, expect, it } from "vitest";
import type { EvaluationResult, EvolveProject } from "@evolution/contracts";
import {AcceptanceCriterionSchema,TestCaseSchema} from "@evolution/contracts";
import { campaignLiveObservationFresh, campaignObservesLiveTarget,LIVE_TARGET_OBSERVATION_MAX_AGE_MS, campaignRootBaselineForMeasurement, campaignScoringInputBlocker, campaignScoringInputFingerprint } from "./campaign-scoring-input";

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
  it.each(["external-runner","visual-review"] as const)("does not expire fixed HTML %s solely because its browser execution is external",mode=>{
    const p=project();p.sourceArtifacts=[{...p.sourceArtifacts[0]!,extension:"html",artifactKind:"document",mimeType:"text/html",inputMode:"upload",textContent:"<html></html>"}];
    const criterion=AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Protection",requirement:"Preserve interactions",source:"user-command",weight:1,minScore:95,hardGate:true,validationMethod:"executable-test",artifactIds:["source"]});
    p.acceptanceRubric=[criterion];p.evalSuite=[TestCaseSchema.parse({id:"fixed-html",title:"Fixed HTML",input:"Inspect the recorded file",expected:["Preserved"],criterionIds:[criterion.id],executionMode:mode})];p.hiddenEvalSuite=[];
    const before=campaignScoringInputFingerprint(p);expect(campaignObservesLiveTarget(p)).toBe(true);
    expect(campaignLiveObservationFresh(p,"2026-09-28T00:00:00.000Z",Date.parse("2026-10-28T00:00:00.000Z"))).toBe(true);
    expect(campaignScoringInputFingerprint({...p,sourceArtifacts:[{...p.sourceArtifacts[0]!,textContent:"<html>changed</html>"}]})).not.toBe(before);
    expect(campaignObservesLiveTarget({...p,targetConnection:{...p.targetConnection,adapter:"http"}})).toBe(true);
    expect(campaignObservesLiveTarget({...p,evalSuite:[...p.evalSuite,TestCaseSchema.parse({id:"other-live",title:"Live",input:"Remote state",expected:["Current"],executionMode:"external-runner"})]})).toBe(true);
    expect(campaignObservesLiveTarget({...p,sourceArtifacts:[{...p.sourceArtifacts[0]!,role:"reference"}]})).toBe(true);
    for(const mutable of [{...p,targetConnection:{...p.targetConnection,adapter:"http" as const}},
      {...p,evalSuite:[...p.evalSuite,TestCaseSchema.parse({id:"other-live",title:"Live",input:"Remote state",expected:["Current"],executionMode:"external-runner"})]},
      {...p,sourceArtifacts:[{...p.sourceArtifacts[0]!,role:"reference" as const}]}])
      expect(campaignLiveObservationFresh(mutable,"2026-09-28T00:00:00.000Z",Date.parse("2026-10-28T00:00:00.000Z"))).toBe(false);
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
