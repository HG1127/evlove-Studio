import {describe,expect,it} from "vitest";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import type {EvolveProject} from "@evolution/contracts";
import {reviewedHoldoutBoundary} from "./reviewed-holdout-policy";

describe("human Original REVIEW grants isolated evidence collection only",()=>{
  it("admits the same frozen independently evaluated winner while preserving REVIEW",()=>{
    const {project:p}=reviewedHoldoutFixture(),before=structuredClone(p);
    expect(reviewedHoldoutBoundary(p)).toBeUndefined();expect(p).toEqual(before);expect(p.baselineRun.result!.safety).toBe("REVIEW");
    expect(p.acceptanceRubric[0]!.minScore).toBe(92);
  });
  const cases:[string,(p:EvolveProject)=>void][]=[
    ["FAIL",p=>p.baselineRun.result!.safety="FAIL"],["PASS is no REVIEW approval",p=>p.baselineRun.result!.safety="PASS"],
    ["no review reasons",p=>p.baselineRun.result!.notes=[]],["incomplete baseline",p=>p.baselineRun.status="failed"],
    ["no completed observation",p=>p.baselineRun.completedAt=undefined],["live adapter",p=>p.targetConnection.adapter="http"],
    ["paste",p=>p.sourceArtifacts[0]!.inputMode="paste"],["not HTML",p=>p.sourceArtifacts[0]!.mimeType="text/plain"],
    ["extra sources",p=>p.sourceArtifacts.push({...p.sourceArtifacts[0]!,id:"reference",role:"reference"})],
    ["new round",p=>p.campaign.currentRound=1],["running",p=>p.campaign.status="running"],
    ["wrong checkpoint",p=>p.campaign.checkpoint!.completedPhase="validation"],["wrong checkpoint round",p=>p.campaign.checkpoint!.round=2],["scheduled",p=>p.campaign.schedule.enabled=true],
    ["release",p=>p.release.status="shadow"],["accepted",p=>p.artifactAcceptance.status="passed"],
    ["not winner",p=>p.experimentRun.winnerId=undefined],["unfinished experiment",p=>p.experimentRun.status="failed"],
    ["duplicate winner",p=>p.candidates.push({...p.candidates[0]!})],["duplicate judgment",p=>p.experimentRun.candidateResults.push({...p.experimentRun.candidateResults[0]!})],
    ["winner REVIEW",p=>p.experimentRun.candidateResults[0]!.evaluation.safety="REVIEW"],
    ["no frozen bytes",p=>p.candidates[0]!.artifactSnapshots[0]!.frozenArtifact=undefined],
    ["other snapshot",p=>p.candidates[0]!.artifactSnapshots[0]!.sourceArtifactId="other"],
    ["Hidden REVIEW",p=>p.validationRun.evaluation={...p.baselineRun.result!,safety:"REVIEW"}],
    ["Hidden current FAIL",p=>p.validationRun.baselineEvaluation={...p.baselineRun.result!,safety:"FAIL"}],
    ["pending approval",p=>p.attentionRequests=[{id:"a",type:"authorization",status:"pending",blocking:true} as NonNullable<EvolveProject["attentionRequests"]>[number]]],
    ["Target Ready",p=>p.gates=[]],["goal",p=>p.goal=""],["budget",p=>p.campaign.stopCriteria.maxEstimatedCost=0],
    ["round limit",p=>p.campaign.stopCriteria.maxRounds=0],
  ];
  it.each(cases)("rejects %s",(_name,change)=>{const {project:p}=reviewedHoldoutFixture();change(p);expect(reviewedHoldoutBoundary(p)).toBeTruthy();});
  it("requires new downstream safety PASS before conditional Gate F",()=>{
    const {project:p}=reviewedHoldoutFixture();p.campaign.status="running";p.campaign.checkpoint!.completedPhase="validation";
    p.validationRun.evaluation={...p.baselineRun.result!,safety:"REVIEW"};
    expect(reviewedHoldoutBoundary(p,"acceptance")).toBe("downstream-safety-boundary");
  });
});
