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
it("rejects a copied paper relabeled as another mode or padded with unused browser operands",()=>{
  const {p}=fixture();
  expect(()=>assertIndependentFinalPaper(p,[{...p.hiddenEvalSuite[0]!,id:"RENAMED",executionMode:"static-evidence",evidenceScope:"implementation"}])).toThrow(/复制/);
  p.hiddenEvalSuite[0]!.browserSteps=[{action:"count",selector:"article",count:111}];
  expect(()=>assertIndependentFinalPaper(p,[{...p.hiddenEvalSuite[0]!,id:"RENAMED",browserSteps:[{action:"count",selector:"article",count:111,value:"unused"}]}])).toThrow(/复制/);
});
it("enforces hard minima even if a Judge supplies a contradictory pass flag",()=>{
  const {p,c,proof}=fixture();p.validationRun.independentFinal=proof;
  proof.evaluation!.criterionScores![0]!.score=20;
  expect(independentFinalReadiness(p,c)).toMatchObject({ready:false,failed:true});
});

function mixedFinal(){
  const f=fixture(),{p,c,proof}=f;
  p.acceptanceRubric.push({...p.acceptanceRubric[0]!,id:"OTHER"});
  proof.suite.push({...proof.suite[0]!,id:"F2",input:"separate protection scenario",criterionIds:["OTHER"]});
  proof.runs.push({...proof.runs[0]!,testCaseId:"F2",verificationStatus:"partial"});
  proof.baselineRuns.push({...proof.baselineRuns[0]!,testCaseId:"F2",verificationStatus:"unverified"});
  proof.baselineSuiteIds=["F1","F2"];
  proof.evaluation!.criterionScores!.push({...proof.evaluation!.criterionScores![0]!,criterionId:"OTHER",verificationStatus:"partial",testCaseIds:["F2"]});
  proof.evaluation!.criterionScores![0]={...proof.evaluation!.criterionScores![0]!,score:30,pass:false};
  proof.recommendation="hold";
  proof.suite=proof.suite.map(test=>TestCaseSchema.parse(test));
  proof.paperHash=finalHoldoutPaperHash(proof.suite);c.finalHoldoutPaperHash=proof.paperHash;
  proof.inputFingerprint=evidenceFingerprint(p,c);p.validationRun.independentFinal=proof;
  p.validationRun.evidenceFingerprint=evidenceFingerprint(p,c);
  return f;
}
it("retains a same-paper hard failure when unrelated evidence or the baseline is missing",()=>{
  for(const baselineMissing of [false,true]){
    const {p,c,proof}=mixedFinal();
    if(baselineMissing)proof.baselineEvaluation=undefined;
    expect(independentFinalReadiness(p,c)).toMatchObject({ready:false,failed:true});
    expect(proof.runs[1]!.verificationStatus).toBe("partial");
  }
});
it.each(["duplicate-score","duplicate-criterion","contradictory-status","unknown-case","wrong-criterion-case","duplicate-case-ref","partial-run","errored-run","duplicate-run","missing-run","empty-run","demo","wrong-candidate","wrong-input","browser-summary"])("does not strengthen an unbound mixed final failure: %s",kind=>{
  const {p,c,proof}=mixedFinal(),score=proof.evaluation!.criterionScores![0]!;
  if(kind==="duplicate-score")proof.evaluation!.criterionScores!.push({...score});
  if(kind==="duplicate-criterion"){
    p.acceptanceRubric.push({...p.acceptanceRubric[0]!});proof.inputFingerprint=evidenceFingerprint(p,c);
  }
  if(kind==="contradictory-status")proof.evaluation!.unverifiedCriterionIds=["CONTENT"];
  if(kind==="unknown-case")score.testCaseIds=["orphan"];
  if(kind==="wrong-criterion-case")score.testCaseIds=["F2"];
  if(kind==="duplicate-case-ref")score.testCaseIds=["F1","F1"];
  if(kind==="partial-run")proof.runs[0]!.verificationStatus="partial";
  if(kind==="errored-run")proof.runs[0]!.error="unavailable";
  if(kind==="duplicate-run")proof.runs.push({...proof.runs[0]!});
  if(kind==="missing-run")proof.runs.shift();
  if(kind==="empty-run")proof.runs[0]!.output=" ";
  if(kind==="demo")proof.evaluation!.demoJudged=true;
  if(kind==="wrong-candidate")proof.candidateId="other";
  if(kind==="wrong-input")proof.inputFingerprint="changed";
  if(kind==="browser-summary"){
    proof.suite[0]!.browserSteps=[{action:"visible",selector:"#actual"}];
    proof.suite=proof.suite.map(test=>TestCaseSchema.parse(test));
    proof.paperHash=finalHoldoutPaperHash(proof.suite);c.finalHoldoutPaperHash=proof.paperHash;
    proof.inputFingerprint=evidenceFingerprint(p,c);
  }
  expect(independentFinalReadiness(p,c)).toMatchObject({ready:false,failed:false});
});
it("settles a bound mixed final failure without another final execution or targeted repair",async()=>{
  const {p,verify}=mixedFinal(),repair=vi.fn(),final=vi.fn();
  const result=await runServerArtifactAcceptance(p,{verifyFrozenArtifacts:verify,repairCandidate:repair,verifyIndependentFinal:final});
  expect(result.accepted).toBe(false);expect(result.reason).toContain("禁止");
  expect(final).not.toHaveBeenCalled();expect(repair).not.toHaveBeenCalled();
  expect(result.project.validationRun.independentFinal).toEqual(p.validationRun.independentFinal);
});
it("never rerolls a completed partial final assessment on resume",async()=>{
  const {p,c,proof,verify}=fixture(),final=vi.fn(),repair=vi.fn();
  proof.runs[0]!.verificationStatus="partial";proof.recommendation="hold";
  p.validationRun.independentFinal=proof;
  const first=await runServerArtifactAcceptance(p,{verifyFrozenArtifacts:verify,repairCandidate:repair,verifyIndependentFinal:final});
  const second=await runServerArtifactAcceptance(first.project,{verifyFrozenArtifacts:verify,repairCandidate:repair,verifyIndependentFinal:final});
  expect(second.accepted).toBe(false);expect(second.project.validationRun.independentFinal).toEqual(proof);
  expect(final).not.toHaveBeenCalled();expect(repair).not.toHaveBeenCalled();expect(independentFinalReadiness(p,c).ready).toBe(false);
});
it("does not promote a completed semantic pass that declared unexecuted browser predicates",()=>{
  const {p,c,proof}=fixture();
  proof.suite[0]!.browserSteps=[{action:"visible",selector:"#actual"}];
  proof.suite=proof.suite.map(test=>TestCaseSchema.parse(test));
  proof.paperHash=finalHoldoutPaperHash(proof.suite);c.finalHoldoutPaperHash=proof.paperHash;
  proof.inputFingerprint=evidenceFingerprint(p,c);p.validationRun.independentFinal=proof;
  expect(independentFinalReadiness(p,c)).toMatchObject({ready:false,failed:false,reason:expect.stringContaining("浏览器")});
});
it.each(["bound","missing-hash","wrong-hash","duplicate-snapshot"])("requires scoped physical identity for a browser hard failure: %s",kind=>{
  const {p,c,proof}=mixedFinal();
  proof.suite[0]!.executionMode="external-runner";proof.suite[0]!.browserSteps=[{action:"visible",selector:"#actual"}];
  if(kind!=="missing-hash")proof.runs[0]!.artifactHash=kind==="wrong-hash"?"0".repeat(64):c.artifactSnapshots[0]!.frozenArtifact!.sha256;
  if(kind==="duplicate-snapshot")c.artifactSnapshots.push({...c.artifactSnapshots[0]!});
  proof.suite=proof.suite.map(test=>TestCaseSchema.parse(test));
  proof.paperHash=finalHoldoutPaperHash(proof.suite);c.finalHoldoutPaperHash=proof.paperHash;
  proof.inputFingerprint=evidenceFingerprint(p,c);
  expect(independentFinalReadiness(p,c)).toMatchObject({ready:false,failed:kind==="bound"});
});
