// @vitest-environment node
import {describe,expect,it} from "vitest";
import {ArtifactRepairAttemptSchema,IndependentFinalEvidenceSchema} from "@evolution/contracts";
import {bindHiddenRepairFixture,hiddenRepairFixture} from "@evolution/testkit";
import {hiddenRepairFeedbackContext,hiddenRepairTarget,ordinaryHiddenGoalProgress} from "./hidden-repair";
import {artifactRepairStopReason} from "./artifact-repair-policy";
import {settleArtifactAcceptanceFromValidation,verifiedValidationFailures} from "./artifact-acceptance-settlement";
import {evidenceFingerprint} from "./evidence-binding";
import {finalHoldoutContractFingerprint} from "./independent-final-holdout";

const ids=(p:ReturnType<typeof hiddenRepairFixture>)=>hiddenRepairTarget(p.p,p.current).failedCriteria.map(c=>c.id);
function claimed(){
  const x=hiddenRepairFixture("mixed"),target=hiddenRepairTarget(x.p,x.current),p=x.p;
  p.artifactAcceptance.attempts=1;p.campaign.estimatedCost=.2;
  p.artifactRepairAttempts=[ArtifactRepairAttemptSchema.parse({version:"artifact-targeted-repair-v2",id:"claim",round:1,attempt:1,status:"running",parentCandidateId:x.current.id,
    inputFingerprint:"a".repeat(64),finalPaperHash:p.finalHoldout!.paperHash,failedCriterionIds:target.failedCriteria.map(c=>c.id),feedbackKind:target.feedbackKind,estimatedCost:.2,startedAt:new Date().toISOString(),
    evidence:{version:"repair-evidence-reference-v1",artifactId:"evidence",missionId:p.id,candidateId:x.current.id,sha256:"b".repeat(64),size:1,mimeType:"application/json"}})];
  return x;
}
describe("versioned ordinary Hidden feedback scope",()=>{
  it("requires v2 to be bound before blind reservation while legacy v1 keeps its old fingerprint",()=>{
    const x=hiddenRepairFixture("mixed"),p=x.p,bound=p.finalHoldout!.contractFingerprint;
    delete p.experimentPolicy.hiddenFailureRepair;const legacy=finalHoldoutContractFingerprint(p);
    p.experimentPolicy.hiddenFailureRepair="artifact-targeted-repair-v1";expect(finalHoldoutContractFingerprint(p)).toBe(legacy);expect(bound).not.toBe(legacy);
    p.validationRun.evidenceFingerprint=evidenceFingerprint(p,x.current);
    expect(artifactRepairStopReason(p,x.current)).toContain("规划前");
  });
  it("keeps a legacy absolute PASS out of v1 repair while v2 selects the proven paired regression",()=>{
    const x=hiddenRepairFixture();expect(verifiedValidationFailures(x.p,x.p.validationRun)).toEqual([]);expect(ids(x)).toEqual(["READABILITY"]);
    expect(hiddenRepairTarget(x.p,x.current)).toMatchObject({feedbackKind:"relative-target-regression",comparisons:[{criterionId:"READABILITY",baselineScore:90,currentScore:89,absoluteMinimumPassed:true}]});
    expect(artifactRepairStopReason(x.p,x.current)).toBeUndefined();expect(x.p.validationRun.evaluation!.criterionScores![1]!.pass).toBe(true);
    delete x.p.experimentPolicy.hiddenFailureRepair;bindHiddenRepairFixture(x.p,x.current);
    expect(ids(x)).toEqual([]);expect(artifactRepairStopReason(x.p,x.current)).toContain("Hidden 失败");
  });
  it("combines complete paired regressions with absolute failures in rubric order",()=>{
    const x=hiddenRepairFixture("mixed");expect(ids(x)).toEqual(["CONTENT","READABILITY"]);
    expect(hiddenRepairTarget(x.p,x.current)).toMatchObject({feedbackKind:"combined-criterion-failure",comparisons:[{criterionId:"READABILITY",absoluteMinimumPassed:true}]});
    x.p.validationRun.evaluation!.criterionScores![0]!.pass=true;
    expect(ids(x)).toEqual(["CONTENT","READABILITY"]);expect(x.p.validationRun.evaluation!.criterionScores![0]!.score).toBe(70);
  });
  it.each(["candidate-binding","wrong-case","duplicate-score","partial-score","missing-baseline-run","duplicate-baseline-run","partial-baseline-run","errored-run","empty-run","baseline-paper","baseline-context","baseline-time","demo","contradictory-unverified","no-goal-policy"])("does not invent a relative target from %s evidence",kind=>{
    const x=hiddenRepairFixture(),v=x.p.validationRun;
    if(kind==="candidate-binding")v.evidenceFingerprint="foreign";
    if(kind==="wrong-case")v.evaluation!.criterionScores![1]!.testCaseIds=["F1"];
    if(kind==="duplicate-score")v.evaluation!.criterionScores!.push({...v.evaluation!.criterionScores![1]!});
    if(kind==="partial-score")v.evaluation!.criterionScores![1]!.verificationStatus="partial";
    if(kind==="missing-baseline-run")v.baselineRuns=[];
    if(kind==="duplicate-baseline-run")v.baselineRuns.push({...v.baselineRuns[0]!});
    if(kind==="partial-baseline-run")v.baselineRuns[0]!.verificationStatus="partial";
    if(kind==="errored-run")v.runs[0]!.error="unavailable";
    if(kind==="empty-run")v.runs[0]!.output=" ";
    if(kind==="baseline-paper")v.baselineSuiteIds=["F1"];
    if(kind==="baseline-context")v.baselineContextFingerprint=undefined;
    if(kind==="baseline-time")v.baselineObservedAt=0;
    if(kind==="demo")v.baselineEvaluation!.demoJudged=true;
    if(kind==="contradictory-unverified")v.evaluation!.unverifiedCriterionIds=["READABILITY"];
    if(kind==="no-goal-policy")delete x.p.experimentPolicy.winnerGoalScope;
    expect(ids(x)).toEqual([]);
  });
  it("retains a measured absolute failure when paired goal evidence is incomplete",()=>{
    const x=hiddenRepairFixture("mixed");x.p.validationRun.baselineRuns[0]!.verificationStatus="partial";
    expect(ids(x)).toEqual(["CONTENT"]);expect(hiddenRepairTarget(x.p,x.current).feedbackKind).toBe("absolute-criterion-failure");
  });
  it("never substitutes final feedback for an ordinary Hidden repair or starts another call after final consumption",()=>{
    const x=hiddenRepairFixture(),p=x.p;
    p.validationRun.independentFinal=IndependentFinalEvidenceSchema.parse({...p.validationRun,paperHash:p.finalHoldout!.paperHash,suite:p.finalHoldout!.suite,inputFingerprint:p.validationRun.evidenceFingerprint});
    expect(artifactRepairStopReason(p,x.current)).toContain("独立终验");
    p.validationRun.evaluation!.criterionScores![1]!.score=91;
    expect(ids(x)).toEqual([]);
  });
  it("cannot accept a release-labelled ordinary Hidden regression or incomplete goal evidence",()=>{
    const x=hiddenRepairFixture(),p=x.p;
    expect(ordinaryHiddenGoalProgress(p,x.current)).toMatchObject({ready:true,regressedCriterionIds:["READABILITY"]});
    const settle=()=>settleArtifactAcceptanceFromValidation({project:p,candidate:x.current,validation:p.validationRun,frozenArtifacts:x.current.artifactSnapshots.map(s=>s.frozenArtifact!)});
    expect(settle().status).toBe("failed");p.validationRun.baselineRuns=[];expect(settle().status).toBe("unverified");
  });
  it("revalidates the complete already-debited claim and preserves truthful PASS comparisons",()=>{
    const x=claimed();expect(hiddenRepairFeedbackContext(x.p,x.current,["CONTENT","READABILITY"],1)).toMatchObject({kind:"combined-criterion-failure",comparisons:[{criterionId:"READABILITY",currentScore:89,baselineScore:90,absoluteMinimumPassed:true}]});
  });
  it.each(["scope","kind","policy","paper","cost","budget","deadline","duplicate-claim","consumed-final"])("rejects %s tampering before v2 mutation",kind=>{
    const x=claimed(),p=x.p,r=p.artifactRepairAttempts![0]!;
    if(kind==="scope")r.failedCriterionIds=["CONTENT"];
    if(kind==="kind"&&r.version==="artifact-targeted-repair-v2")r.feedbackKind="absolute-criterion-failure";
    if(kind==="policy")delete p.experimentPolicy.hiddenFailureRepair;
    if(kind==="paper")p.finalHoldout!.paperHash="foreign";
    if(kind==="cost")r.estimatedCost=.3;
    if(kind==="budget")p.artifactAcceptance.attempts=2;
    if(kind==="deadline")p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();
    if(kind==="duplicate-claim")p.artifactRepairAttempts!.push({...r,id:"duplicate"});
    if(kind==="consumed-final")p.validationRun.independentFinal=IndependentFinalEvidenceSchema.parse({...p.validationRun,paperHash:p.finalHoldout!.paperHash,suite:p.finalHoldout!.suite,inputFingerprint:p.validationRun.evidenceFingerprint});
    expect(()=>hiddenRepairFeedbackContext(p,x.current,["CONTENT","READABILITY"],1)).toThrow();
  });
});
