import { describe, expect, it } from "vitest";
import { recoverServerControlAiWait, serverControlAiWait, serverControlCapabilityWaitPlan } from "./server-control-capability";
import type { EvolveProject } from "@evolution/contracts";
import type { ServerHarnessPlan } from "./server-plan";

const plan: ServerHarnessPlan = {
  decision: { action: "run-campaign", stage: "experiment", reason: "next round" },
  checkpoint: { id: "checkpoint-1", stage: "experiment", round: 2 },
  policy: { mode: "auto" },
  sourceRevision: "revision-1",
};
const args = { stage: "diagnosis" as const, reason: "provider unavailable", at: "2026-10-08T00:00:00.000Z" };

describe("server control capability wait", () => {
  it("preserves checkpoint and revision instead of advancing to the planned future stage", () => {
    const wait = serverControlCapabilityWaitPlan(plan, args);
    expect(wait.checkpoint).toEqual(plan.checkpoint);
    expect(wait.sourceRevision).toBe(plan.sourceRevision);
    expect(wait.decision).toMatchObject({ action: "wait-human", stage: "diagnosis" });
    expect(wait.policy.mode).toBe("human");
  });
  it("creates a blocking capability request without claiming product or evidence failure", () => {
    const wait = serverControlCapabilityWaitPlan(plan, args);
    expect(wait.decision.attention).toMatchObject({ type: "capability", status: "pending", blocking: true, questions: [], reason: args.reason });
    expect(wait.decision.attention?.suggestedAction).toContain("保留现有产物");
  });
  it("keeps retry identity stable and leaves its input unchanged", () => {
    const before = structuredClone(plan);
    const first = serverControlCapabilityWaitPlan(plan, args);
    const retry = serverControlCapabilityWaitPlan(plan, { ...args, at: "2026-10-09T00:00:00.000Z", reason: "another outage" });
    expect(first.decision.attention?.id).toBe(retry.decision.attention?.id);
    expect(plan).toEqual(before);
  });
});

function paused() {
  const wait=serverControlCapabilityWaitPlan({...plan,checkpoint:{...plan.checkpoint,id:"server-checkpoint-test"}},args);
  return {
    stage:args.stage,updatedAt:args.at,attentionRequests:[wait.decision.attention!],
    campaign:{status:"paused",stopReason:args.reason,currentRound:2,noImprovementRounds:2,startedAt:"2026-10-01T00:00:00Z",checkpoint:{round:3,completedPhase:"diagnose"},stopCriteria:{patienceRounds:2,maxWallMinutes:30}},
    baselineRun:{id:"baseline",status:"completed"},candidates:[{id:"candidate",artifactSnapshots:[{contentHash:"sha"}]}],validationRun:{id:"validation",status:"idle"},
  } as unknown as EvolveProject;
}
describe("server AI wait recovery policy",()=>{
  it("clears only the owned capability pause and leaves budgets, time and exact evidence intact",()=>{
    const original=paused();
    const before=structuredClone(original);
    const recovered=recoverServerControlAiWait(original,"2026-10-08T12:00:00Z");
    expect(recovered.campaign).toEqual({...original.campaign,status:"idle",stopReason:undefined});
    expect(recovered.campaign.noImprovementRounds).toBe(2);
    expect(recovered.campaign.startedAt).toBe(original.campaign.startedAt);
    expect(recovered.candidates).toEqual(original.candidates);
    expect(recovered.baselineRun).toEqual(original.baselineRun);
    expect(recovered.validationRun).toEqual(original.validationRun);
    expect(recovered.stage).toBe(original.stage);
    expect(recovered.attentionRequests?.[0]).toMatchObject({status:"resolved",resolvedAt:"2026-10-08T12:00:00Z"});
    expect(original).toEqual(before);
    expect(recoverServerControlAiWait(recovered,"later")).toBe(recovered);
  });
  it.each(["running","idle","completed"])("does not clear a %s Campaign",status=>{
    const project=paused();project.campaign.status=status as EvolveProject["campaign"]["status"];
    expect(serverControlAiWait(project)).toBeUndefined();
    expect(recoverServerControlAiWait(project,"later")).toBe(project);
  });
  it("preserves a changed safety reason or stage",()=>{
    for(const change of [{campaign:{...paused().campaign,stopReason:"budget exhausted"}},{stage:"validation" as const}]){
      const project={...paused(),...change};
      expect(recoverServerControlAiWait(project,"later")).toBe(project);
    }
  });
  it("preserves another blocking authorization request",()=>{
    const project=paused();
    project.attentionRequests!.push({...project.attentionRequests![0],id:"authorization",type:"authorization"});
    expect(recoverServerControlAiWait(project,"later")).toBe(project);
  });
  it("rejects foreign or resolved requests",()=>{
    for(const change of [{id:"foreign-capability"},{status:"resolved" as const}]){
      const project=paused();project.attentionRequests![0]={...project.attentionRequests![0],...change};
      expect(recoverServerControlAiWait(project,"later")).toBe(project);
    }
  });
});
