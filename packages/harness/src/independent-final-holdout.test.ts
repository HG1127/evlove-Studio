import {expect,it,vi} from "vitest";
import {IndependentFinalEvidenceSchema,TestCaseSchema} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {assertIndependentFinalPaper,evidenceFingerprint,finalHoldoutPaperHash,independentFinalReadiness,deliveryReadiness} from "@evolution/core";
import {runServerArtifactAcceptance} from "./server-artifact-acceptance";

function fixture(){
  const {project:p,current:c}=acceptedPackageFixture(false);
  p.acceptanceRubric=[{id:"CONTENT",title:"content",requirement:"correct",source:"user-command",weight:100,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:85,evidenceExpected:["observed"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}];
  p.evalSuite=[TestCaseSchema.parse({id:"V1",title:"visible",input:"visible scenario",expected:["correct"],criterionIds:["CONTENT"]})];
  p.hiddenEvalSuite=[TestCaseSchema.parse({id:"H1",title:"regression",input:"repair regression scenario",expected:["correct"],hidden:true,criterionIds:["CONTENT"]})];
  const suite=[TestCaseSchema.parse({id:"F1",title:"blind final",input:"novel independent scenario",expected:["correct"],hidden:true,criterionIds:["CONTENT"]})];
  c.finalHoldoutPaperHash=finalHoldoutPaperHash(suite);
  const score={criterionId:"CONTENT",score:92,pass:true,verificationStatus:"verified" as const,evidence:["observed"],gaps:[],testCaseIds:["H1"]};
  p.validationRun.evaluation={...p.validationRun.evaluation!,criterionScores:[score]};
  p.validationRun.baselineEvaluation={...p.validationRun.evaluation};
  p.validationRun.evidenceFingerprint=evidenceFingerprint(p,c);
  p.artifactAcceptance.evidenceFingerprint=evidenceFingerprint(p,c);
  p.campaign={...p.campaign,status:"running",checkpoint:{round:1,completedPhase:"validation",at:p.updatedAt}};
  const proof=IndependentFinalEvidenceSchema.parse({candidateId:c.id,inputFingerprint:evidenceFingerprint(p,c),paperHash:c.finalHoldoutPaperHash,suite,status:"completed",
    runs:p.validationRun.runs.map(run=>({...run,testCaseId:"F1"})),baselineRuns:p.validationRun.baselineRuns.map(run=>({...run,testCaseId:"F1"})),
    evaluation:{...p.validationRun.evaluation,criterionScores:[{...score,testCaseIds:["F1"]}]},baselineEvaluation:{...p.validationRun.baselineEvaluation,criterionScores:[{...score,testCaseIds:["F1"]}]},
    baselineSuiteIds:["F1"],baselineContextFingerprint:"independent-original",baselineObservedAt:Date.now(),recommendation:"release"});
  const verify=async()=>({verified:c.artifactSnapshots.map(snapshot=>snapshot.frozenArtifact!),unavailable:[],failed:[]});
  return {p,c,proof,verify};
}
it("does not replace required final evidence with a same-paper pass",async()=>{
  const {p,verify}=fixture();
  const result=await runServerArtifactAcceptance(p,{verifyFrozenArtifacts:verify,repairCandidate:vi.fn()});
  expect(result.accepted).toBe(false);expect(result.reason).toContain("独立终验");
});
it("runs independent final verification before Gate F and preserves it in Champion evidence",async()=>{
  const {p,c,proof,verify}=fixture();const final=vi.fn(async()=>proof);
  const result=await runServerArtifactAcceptance(p,{verifyFrozenArtifacts:verify,repairCandidate:vi.fn(),verifyIndependentFinal:final});
  expect(final).toHaveBeenCalledOnce();expect(result.accepted,result.reason).toBe(true);
  expect(result.project.searchChampion?.validation?.independentFinal?.paperHash).toBe(c.finalHoldoutPaperHash);
  expect(deliveryReadiness(result.project).ready).toBe(true);
  result.project.validationRun.independentFinal=undefined;
  expect(deliveryReadiness(result.project).ready).toBe(false);
});
it("does not feed final failures into another targeted repair",async()=>{
  const {p,proof,verify}=fixture();const repair=vi.fn();
  proof.evaluation!.rubricScore=30;proof.evaluation!.criterionScores![0]={...proof.evaluation!.criterionScores![0]!,score:30,pass:false};proof.recommendation="reject";
  const result=await runServerArtifactAcceptance(p,{verifyFrozenArtifacts:verify,repairCandidate:repair,verifyIndependentFinal:async()=>proof});
  expect(result.accepted).toBe(false);expect(result.reason).toContain("禁止");expect(repair).not.toHaveBeenCalled();
});
it.each(["bytes","paper","partial"])("rejects changed %s evidence",scenario=>{
  const {p,c,proof}=fixture();p.validationRun.independentFinal=proof;
  if(scenario==="bytes")c.artifactSnapshots[0]!.content+="tampered";
  if(scenario==="paper")proof.suite[0]!.input="changed scenario";
  if(scenario==="partial")proof.runs[0]!.verificationStatus="partial";
  expect(independentFinalReadiness(p,c).ready).toBe(false);
});
it("rejects a cloned visible/regression case even if its ID was renamed",()=>{
  const {p}=fixture();expect(()=>assertIndependentFinalPaper(p,[{...p.hiddenEvalSuite[0]!,id:"FAKE-FINAL"}])).toThrow(/复制/);
});
it("enforces hard minima even if a Judge supplies a contradictory pass flag",()=>{
  const {p,c,proof}=fixture();p.validationRun.independentFinal=proof;
  proof.evaluation!.criterionScores![0]!.score=20;
  expect(independentFinalReadiness(p,c)).toMatchObject({ready:false,failed:true});
});
