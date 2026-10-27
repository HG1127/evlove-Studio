import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {CandidateDesignRationaleSchema,EvolveProjectSchema,IndependentFinalEvidenceSchema,TestCaseSchema,VisibleRepairAttemptSchema,type EvolveProject,type EvaluateAiResult,type RepairEvidenceArchiveInput} from "@evolution/contracts";
import {evidenceFingerprint,finalHoldoutContractFingerprint,finalHoldoutPaperHash,materializeAcceptedChampionPackage,visibleRepairTarget,visibleRepairFeedbackContext} from "@evolution/core";
import {experimentRecoveryFixture} from "@evolution/testkit";
import {runServerExperiment} from "./server-experiment";
import {hasServerPendingVisibleRepair,prepareServerVisibleRepair,runServerVisibleRepair} from "./server-visible-repair";
import {hasServerFrozenValidationCheckpoint} from "./server-frozen-validation-checkpoint";
import {runServerHoldout} from "./server-holdout";
import {runServerArtifactAcceptance} from "./server-artifact-acceptance";

const fingerprint=async(wire:string)=>createHash("sha256").update(wire).digest("hex");
const judge=(score:number,testCaseId="V1"):EvaluateAiResult=>({accuracy:score,evidence:score,riskCoverage:90,completeness:score,safety:"PASS",notes:[],failures:score<80?["configuration incomplete"]:[],
  cases:[{testCaseId,accuracy:score,evidence:score,completeness:score,reason:"synthetic"}],
  criteria:[{criterionId:"CONTENT",score,pass:score>=80,evidence:["synthetic measured prose"],gaps:score<80?["missing concrete configuration"]:[],testCaseIds:[testCaseId]}]});
function fixture(){
  const x=experimentRecoveryFixture(),p=x.project;
  p.evalSuite[0]!.executionMode="artifact-runtime";
  p.acceptanceRubric[0]={...p.acceptanceRubric[0]!,hardGate:false,validationMethod:"semantic-judge"};
  p.hiddenEvalSuite=[TestCaseSchema.parse({...p.evalSuite[0]!,id:"H1",hidden:true,input:"hidden regression scenario"})];
  p.experimentPolicy.visibleFailureRepair="experiment-visible-repair-v1";
  p.artifactAcceptance={...p.artifactAcceptance,attempts:0,maxRepairAttempts:1,hardGatePass:false};
  p.campaign.stopCriteria={...p.campaign.stopCriteria,maxRounds:1,patienceRounds:1,maxEstimatedCost:100,maxWallMinutes:30,stopOnSafetyFailure:true};
  p.campaign.startedAt=new Date().toISOString();
  const suite=[TestCaseSchema.parse({...p.evalSuite[0]!,id:"FINAL",hidden:true,input:"independent scenario kept secret",expected:["independent expected"]})];
  p.finalHoldout={round:1,suite,paperHash:finalHoldoutPaperHash(suite),contractFingerprint:finalHoldoutContractFingerprint(p),createdAt:new Date(Date.now()-1000).toISOString()};
  x.current.finalHoldoutPaperHash=p.finalHoldout.paperHash;
  const verifyFrozenArtifact=vi.fn(async()=>true);
  const archives=new Map<string,string>();
  const archiveRepairEvidence=vi.fn(async(input:RepairEvidenceArchiveInput)=>{
    archives.set(input.sha256,input.content);
    return {version:"repair-evidence-reference-v1" as const,artifactId:`evidence-${input.sha256}`,missionId:input.missionId,candidateId:input.candidateId,
      sha256:input.sha256,size:input.size,mimeType:"application/json" as const};
  });
  const ports={fingerprint,verifyFrozenArtifact,buildCandidate:vi.fn(async()=>x.current),
    archiveRepairEvidence,executeSemanticBatch:async()=>({results:[]}),judge:async()=>judge(50)};
  return {...x,p,ports,archives};
}
async function reserved(){
  const x=fixture(),out=await runServerExperiment(x.p,x.ports);
  expect(out.readyForVisibleRepair).toBe(true);
  return {...x,project:out.project,out};
}
function execution(x:Awaited<ReturnType<typeof reserved>>){
  const persistProject=vi.fn<(project:EvolveProject)=>Promise<void>>(async()=>undefined);
  const repairCandidate=vi.fn(async()=>({...x.prior,finalHoldoutPaperHash:x.project.finalHoldout!.paperHash}));
  return {...x.ports,persistProject,repairCandidate};
}

describe("bounded Visible feedback repair",()=>{
  function relativeFixture(){
    const x=fixture(),baseline=x.p.baselineRun.result!;
    x.p.experimentPolicy.visibleFailureRepair="experiment-visible-repair-v2";
    x.current.designRationale=CandidateDesignRationaleSchema.parse({coveredCriteria:["CONTENT"]});
    baseline.accuracy=90;baseline.evidence=90;baseline.completeness=90;baseline.rubricScore=90;
    baseline.criterionScores![0]={...baseline.criterionScores![0]!,score:90,pass:true,gaps:[]};
    x.ports.judge=async()=>judge(89);
    return x;
  }
  it("reserves v2 repair for a verified regressed target whose absolute minimum still passes",async()=>{
    const x=relativeFixture(),out=await runServerExperiment(x.p,x.ports);
    expect(out.experiment.candidateResults[0]!.evaluation.criterionScores![0]).toMatchObject({score:89,pass:true,verificationStatus:"verified"});
    expect(out.readyForVisibleRepair).toBe(true);expect(out.project.campaign.currentRound).toBe(0);
    expect(out.project.visibleRepairAttempts?.[0]).toMatchObject({feedbackKind:"relative-target-regression",failedCriterionIds:["CONTENT"],attempt:1,status:"reserved"});
    expect(out.project.acceptanceRubric).toEqual(x.p.acceptanceRubric);expect(out.project.finalHoldout).toEqual(x.p.finalHoldout);
    expect(out.project.outputArtifacts).toHaveLength(0);
  });
  it("claims a relative repair without rewriting PASS scores and measures the exact child again",async()=>{
    const x=relativeFixture(),out=await runServerExperiment(x.p,x.ports),reservation={...x,project:out.project,out},ports=execution(reservation);
    ports.repairCandidate.mockImplementation(async()=>{
      const claimed=ports.persistProject.mock.calls[0]![0];
      expect(visibleRepairFeedbackContext(claimed,x.current,["CONTENT"],1)).toEqual({kind:"relative-target-regression",
        comparisons:[{criterionId:"CONTENT",minScore:80,baselineScore:90,currentScore:89,absoluteMinimumPassed:true}]});
      expect(claimed.experimentRun.candidateResults[0]!.evaluation.criterionScores![0]!.pass).toBe(true);
      return {...x.prior,finalHoldoutPaperHash:out.project.finalHoldout!.paperHash};
    });
    const repaired=await runServerVisibleRepair(EvolveProjectSchema.parse(out.project),ports);
    expect(repaired.repaired).toBe(true);expect(repaired.project.artifactAcceptance.attempts).toBe(1);
    const measured=await runServerExperiment(repaired.project,{...x.ports,judge:async()=>judge(95)});
    expect(measured.readyForHoldout).toBe(true);expect(measured.winnerId).toBe(x.prior.id);
    expect(measured.project.finalHoldout).toEqual(out.project.finalHoldout);expect(measured.project.outputArtifacts).toHaveLength(0);
  });
  it.each([89,95])("routes an omitted user goal through the shared repair and remeasures the frozen child (%i)",async childScore=>{
    const x=relativeFixture(),p=x.p;
    p.experimentPolicy.winnerGoalScope="all-user-goals-v1";
    p.acceptanceRubric[0]!.weight=50;
    p.acceptanceRubric.push({...p.acceptanceRubric[0]!,id:"UNDERSTAND",title:"understandability",weight:50});
    p.evalSuite[0]!.criterionIds.push("UNDERSTAND");p.hiddenEvalSuite[0]!.criterionIds.push("UNDERSTAND");
    p.baselineRun.result!.criterionScores!.push({...p.baselineRun.result!.criterionScores![0]!,criterionId:"UNDERSTAND"});
    p.finalHoldout!.suite[0]!.criterionIds.push("UNDERSTAND");
    p.finalHoldout!.paperHash=finalHoldoutPaperHash(p.finalHoldout!.suite);
    p.finalHoldout!.contractFingerprint=finalHoldoutContractFingerprint(p);x.current.finalHoldoutPaperHash=p.finalHoldout!.paperHash;
    x.ports.judge=async()=>({...judge(94),criteria:[...judge(94).criteria,{...judge(89).criteria[0]!,criterionId:"UNDERSTAND"}]});
    const out=await runServerExperiment(p,x.ports),ports=execution({...x,project:out.project,out});
    expect(out.readyForVisibleRepair).toBe(true);
    expect(out.project.visibleRepairAttempts?.[0]).toMatchObject({feedbackKind:"relative-target-regression",failedCriterionIds:["UNDERSTAND"],attempt:1});
    expect(out.experiment.candidateResults[0]!.evaluation.criterionScores!.every(c=>c.pass)).toBe(true);
    expect(x.current.designRationale!.coveredCriteria).toEqual(["CONTENT"]);
    ports.repairCandidate.mockImplementation(async()=>{
      const claimed=ports.persistProject.mock.calls[0]![0];
      expect(visibleRepairFeedbackContext(claimed,x.current,["UNDERSTAND"],1)?.comparisons[0]).toMatchObject({criterionId:"UNDERSTAND",baselineScore:90,currentScore:89,absoluteMinimumPassed:true});
      return {...x.prior,finalHoldoutPaperHash:p.finalHoldout!.paperHash};
    });
    const repaired=await runServerVisibleRepair(out.project,ports);
    expect(repaired.repaired).toBe(true);expect(repaired.project.artifactAcceptance.attempts).toBe(1);
    expect(ports.archiveRepairEvidence).toHaveBeenCalledOnce();expect(ports.persistProject).toHaveBeenCalledOnce();expect(ports.repairCandidate).toHaveBeenCalledOnce();
    expect(repaired.project.finalHoldout).toEqual(p.finalHoldout);expect(repaired.project.outputArtifacts).toHaveLength(0);
    const rebuild=vi.fn(async()=>{throw Error("must remeasure the exact frozen repair");});
    const measured=await runServerExperiment(repaired.project,{...x.ports,buildCandidate:rebuild,
      judge:async()=>({...judge(95),criteria:[...judge(95).criteria,{...judge(childScore).criteria[0]!,criterionId:"UNDERSTAND"}]})});
    expect(rebuild).not.toHaveBeenCalled();expect(measured.readyForHoldout).toBe(childScore===95);
    expect(measured.readyForVisibleRepair).not.toBe(true);expect(measured.project.artifactAcceptance.attempts).toBe(1);
    expect(measured.project.finalHoldout).toEqual(p.finalHoldout);expect(measured.project.outputArtifacts).toHaveLength(0);
  });
  it("rejects an altered feedback classification before mutation",async()=>{
    const x=relativeFixture(),out=await runServerExperiment(x.p,x.ports),ports=execution({...x,project:out.project,out});
    const record=out.project.visibleRepairAttempts![0]!;
    if(record.version!=="experiment-visible-repair-v2")throw Error("Expected v2 history");
    record.feedbackKind="absolute-criterion-failure";
    expect((await runServerVisibleRepair(out.project,ports)).repaired).toBe(false);expect(ports.repairCandidate).not.toHaveBeenCalled();
  });
  it.each(["v1","protected","unverified-baseline","wrong-case","duplicate-baseline","no-regression"])("does not route %s as a proven relative regression",async kind=>{
    const x=relativeFixture();
    if(kind==="v1")x.p.experimentPolicy.visibleFailureRepair="experiment-visible-repair-v1";
    if(kind==="protected")x.p.acceptanceRubric[0]!.protectedConstraint=true;
    if(kind==="unverified-baseline")x.p.baselineRun.result!.criterionScores![0]!.verificationStatus="partial";
    if(kind==="wrong-case")x.p.baselineRun.result!.criterionScores![0]!.testCaseIds=["OTHER"];
    if(kind==="duplicate-baseline")x.p.baselineRun.result!.criterionScores!.push({...x.p.baselineRun.result!.criterionScores![0]!});
    if(kind==="no-regression")x.ports.judge=async()=>judge(90);
    // Keep the existing paper's contract valid after explicitly changing a protected fixture criterion.
    if(kind==="protected")x.p.finalHoldout!.contractFingerprint=finalHoldoutContractFingerprint(x.p);
    const out=await runServerExperiment(x.p,x.ports);
    expect(out.readyForVisibleRepair).not.toBe(true);expect(out.project.artifactAcceptance.attempts).toBe(0);
  });
  it("keeps legacy missions unchanged and preserves a reservation through the storage schema",async()=>{
    const x=fixture();delete x.p.experimentPolicy.visibleFailureRepair;
    const legacy=await runServerExperiment(x.p,x.ports);
    expect(legacy.readyForVisibleRepair).toBeUndefined();expect(legacy.project.campaign.currentRound).toBe(1);
    expect(legacy.project.visibleRepairAttempts).toBeUndefined();expect(legacy.project.artifactAcceptance.attempts).toBe(0);
    const fresh=await reserved(),stored=EvolveProjectSchema.parse(fresh.project);
    expect(stored.visibleRepairAttempts?.[0]).toMatchObject({status:"reserved",attempt:1,parentCandidateId:fresh.current.id});
    expect(stored.visibleRepairAttempts?.[0]).toMatchObject({version:"experiment-visible-repair-v2",experimentFingerprint:expect.stringMatching(/^[0-9a-f]{64}$/)});
    expect(stored.visibleRepairAttempts?.[0]).not.toHaveProperty("experiment");expect(fresh.ports.archiveRepairEvidence).not.toHaveBeenCalled();
    expect(stored.artifactAcceptance.attempts).toBe(1);expect(stored.campaign.currentRound).toBe(0);
    expect(hasServerPendingVisibleRepair(stored)).toBe(true);expect(hasServerFrozenValidationCheckpoint(stored)).toBe(true);
    expect(await prepareServerVisibleRepair(stored,fresh.ports,new Date().toISOString())).toBeUndefined();
  });
  it("persists a claim before AI, preserves failure evidence, and measures the exact child before Hidden",async()=>{
    const x=await reserved(),ports=execution(x),old=structuredClone(x.project.experimentRun);
    ports.repairCandidate.mockImplementation(async()=>{
      expect(ports.persistProject).toHaveBeenCalledOnce();
      expect(ports.persistProject.mock.calls[0]![0].visibleRepairAttempts?.[0]?.status).toBe("running");
      expect(ports.persistProject.mock.calls[0]![0].visibleRepairAttempts?.[0]).toHaveProperty("evidence");
      expect(EvolveProjectSchema.parse(ports.persistProject.mock.calls[0]![0]).visibleRepairAttempts?.[0]).toEqual(ports.persistProject.mock.calls[0]![0].visibleRepairAttempts?.[0]);
      expect(ports.archiveRepairEvidence).toHaveBeenCalledOnce();
      return {...x.prior,finalHoldoutPaperHash:x.project.finalHoldout!.paperHash};
    });
    const repaired=await runServerVisibleRepair(EvolveProjectSchema.parse(x.project),ports);
    expect(repaired.repaired).toBe(true);expect(repaired.project.campaign.currentRound).toBe(0);
    expect(repaired.project.artifactAcceptance).toMatchObject({status:"repairing",attempts:1,hardGatePass:false});
    expect(repaired.project.campaign.estimatedCost).toBeGreaterThanOrEqual(x.project.campaign.estimatedCost);
    const record=VisibleRepairAttemptSchema.parse(repaired.project.visibleRepairAttempts?.[0]);
    expect(record).toMatchObject({status:"frozen",parentCandidateId:x.current.id,candidateId:x.prior.id});
    if(record.version!=="experiment-visible-repair-v2")throw Error("Expected v2 history");
    const report=x.archives.get(record.evidence!.sha256)!;
    expect(JSON.parse(report).experiment).toEqual(old);expect(await fingerprint(report)).toBe(record.evidence!.sha256);
    expect(report).not.toContain("independent scenario kept secret");
    expect(record).not.toHaveProperty("experiment");
    expect(repaired.project.finalHoldout).toEqual(x.project.finalHoldout);
    const rebuild=vi.fn(async()=>{throw Error("must not regenerate frozen child");});
    const measured=await runServerExperiment(repaired.project,{...x.ports,buildCandidate:rebuild,judge:async()=>judge(95)});
    expect(rebuild).not.toHaveBeenCalled();expect(measured.readyForHoldout).toBe(true);
    expect(measured.winnerId).toBe(x.prior.id);expect(measured.project.outputArtifacts).toHaveLength(0);
    expect(measured.project.validationRun.status).toBe("idle");expect(measured.project.artifactAcceptance.status).not.toBe("passed");
    expect(measured.project.visibleRepairAttempts?.[0]).toEqual(record);expect(JSON.parse(report).experiment).toEqual(old);
    expect(measured.project.artifactAcceptance.attempts).toBe(1);
  });
  it.each([95,50])("runs the repaired child through Hidden (%i) and shares the remaining Gate F budget",async score=>{
    const x=await reserved(),repaired=await runServerVisibleRepair(x.project,execution(x));
    const measured=await runServerExperiment(repaired.project,{...x.ports,judge:async()=>judge(95)});
    const executeSemanticBatch=async({testCases}:{testCases:EvolveProject["evalSuite"]})=>({results:testCases.map(test=>({testCaseId:test.id,output:"synthetic measured prose",trace:[]}))});
    const hidden=await runServerHoldout(measured.project,{current:{executeSemanticBatch,judge:async()=>judge(60,"H1"),
      buildCurrentArtifactContext:async()=>[{id:"source",artifactSha256:await fingerprint(x.p.sourceArtifacts[0]!.textContent!),content:"original input",truncated:false,
        contextRepresentation:"complete-html-static-text-projection",originalChars:x.p.sourceArtifacts[0]!.textContent!.length,projectionChars:14,
        excludes:["scripts","styles","visual-fidelity","runtime-behavior"]}]},
      candidate:{...x.ports,executeSemanticBatch,judge:async()=>judge(score,"H1")},
      releaseReview:async()=>({recommendation:score>=80?"release":"hold",summary:"synthetic review",reasons:[],risks:[],requiredChecks:[]})});
    expect(hidden.project.campaign.checkpoint?.completedPhase,hidden.reason).toBe("validation");
    const repairAgain=vi.fn(),final=vi.fn(async()=>{
      const v=hidden.validation,p=hidden.project,suite=p.finalHoldout!.suite;
      return IndependentFinalEvidenceSchema.parse({...v,candidateId:x.prior.id,inputFingerprint:evidenceFingerprint(p,p.candidates.find(c=>c.id===x.prior.id)!),
        paperHash:p.finalHoldout!.paperHash,suite,recommendation:"release",baselineSuiteIds:["FINAL"],
        runs:v.runs.map(run=>({...run,testCaseId:"FINAL"})),baselineRuns:v.baselineRuns.map(run=>({...run,testCaseId:"FINAL"})),
        evaluation:{...v.evaluation,criterionScores:v.evaluation!.criterionScores!.map(s=>({...s,testCaseIds:["FINAL"]}))},
        baselineEvaluation:{...v.baselineEvaluation,criterionScores:v.baselineEvaluation!.criterionScores!.map(s=>({...s,testCaseIds:["FINAL"]}))}});
    });
    const accepted=await runServerArtifactAcceptance(hidden.project,{verifyFrozenArtifacts:async()=>({verified:x.prior.artifactSnapshots.map(s=>s.frozenArtifact!),unavailable:[],failed:[]}),
      repairCandidate:repairAgain,verifyIndependentFinal:final});
    expect(repairAgain).not.toHaveBeenCalled();expect(accepted.project.artifactAcceptance.attempts).toBe(1);
    expect(accepted.accepted,accepted.reason).toBe(score>=80);
    if(score>=80){
      expect(final).toHaveBeenCalledOnce();
      const outputs=materializeAcceptedChampionPackage(accepted.project),primary=outputs.find(output=>output.kind==="primary")!;
      expect(primary.content).toBe(x.prior.artifactSnapshots[0]!.content);
      expect(primary.frozenArtifact?.sha256).toBe(x.prior.artifactSnapshots[0]!.frozenArtifact!.sha256);
    }else{expect(final).not.toHaveBeenCalled();expect(accepted.project.outputArtifacts).toHaveLength(0);}
  });
  it.each(["safety","rounds","wall","budget","capability","suite","baseline","paper","duplicate-score","demo"])("does not reserve a repair for %s",async kind=>{
    const x=await reserved(),p=structuredClone(x.project);
    p.visibleRepairAttempts=[];p.artifactAcceptance.attempts=0;
    if(kind==="safety")p.experimentRun.candidateResults[0]!.evaluation.safety="FAIL";
    if(kind==="rounds")p.campaign.currentRound=1;
    if(kind==="wall")p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();
    if(kind==="budget")p.artifactAcceptance.maxRepairAttempts=0;
    if(kind==="capability")p.experimentRun.candidateResults[0]!.runs[0]!.verificationStatus="partial";
    if(kind==="suite")p.evalSuite[0]!.input="different suite";
    if(kind==="baseline")p.baselineRun.result!.accuracy=1;
    if(kind==="demo")p.experimentRun.candidateResults[0]!.evaluation.demoJudged=true;
    if(kind==="paper")p.finalHoldout!.suite[0]!.input="replaced final question";
    if(kind==="duplicate-score")p.experimentRun.candidateResults[0]!.evaluation.criterionScores!.push({...p.experimentRun.candidateResults[0]!.evaluation.criterionScores![0]!});
    expect(visibleRepairTarget(p)).toBeUndefined();expect(await prepareServerVisibleRepair(p,x.ports,new Date().toISOString())).toBeUndefined();
  });
  it.each(["contract","counter","paper","blob","expired","goal-scope"])("blocks changed %s before paid I/O",async kind=>{
    const x=await reserved(),ports=execution(x),p=structuredClone(x.project);
    if(kind==="contract")p.evolutionCommand="different command";
    if(kind==="counter")p.artifactAcceptance.attempts=0;
    if(kind==="paper")p.finalHoldout!.suite[0]!.expected=["changed secret"];
    if(kind==="blob")ports.verifyFrozenArtifact.mockResolvedValue(false);
    if(kind==="expired")p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();
    if(kind==="goal-scope")p.experimentPolicy.winnerGoalScope="all-user-goals-v1";
    const out=await runServerVisibleRepair(p,ports);expect(out.control).toBe("stop");
    expect(ports.repairCandidate).not.toHaveBeenCalled();expect(ports.persistProject).not.toHaveBeenCalled();
  });
  it("never calls the provider when the revision claim conflicts",async()=>{
    const x=await reserved(),ports=execution(x);ports.persistProject.mockRejectedValue(new Error("revision conflict"));
    await expect(runServerVisibleRepair(x.project,ports)).rejects.toThrow("revision conflict");expect(ports.repairCandidate).not.toHaveBeenCalled();
  });
  it.each(["report","fingerprint"])("rejects changed %s evidence without archiving or calling AI",async kind=>{
    const x=await reserved(),ports=execution(x),p=structuredClone(x.project);
    if(kind==="report")p.experimentRun.candidateResults[0]!.runs[0]!.output="altered measured body";
    else{
      const record=p.visibleRepairAttempts![0]!;
      if(record.version!=="experiment-visible-repair-v2")throw Error("Expected v2 history");
      record.experimentFingerprint="0".repeat(64);
    }
    expect((await runServerVisibleRepair(p,ports)).repaired).toBe(false);
    expect(ports.archiveRepairEvidence).not.toHaveBeenCalled();expect(ports.persistProject).not.toHaveBeenCalled();expect(ports.repairCandidate).not.toHaveBeenCalled();
  });
  it.each(["unavailable","wrong-mission","wrong-parent","wrong-sha","wrong-size"])("keeps the reserved report and never calls AI on %s archive",async kind=>{
    const x=await reserved(),ports=execution(x),before=structuredClone(x.project.experimentRun);
    if(kind==="unavailable")ports.archiveRepairEvidence.mockRejectedValue(Error("storage unavailable"));
    else ports.archiveRepairEvidence.mockImplementation(async input=>({version:"repair-evidence-reference-v1",artifactId:"evidence",mimeType:"application/json",
      missionId:kind==="wrong-mission"?"foreign":input.missionId,candidateId:kind==="wrong-parent"?"foreign":input.candidateId,
      sha256:kind==="wrong-sha"?"0".repeat(64):input.sha256,size:input.size+(kind==="wrong-size"?1:0)}));
    const out=await runServerVisibleRepair(x.project,ports);
    expect(out.reason).toContain("归档或回读失败");expect(out.project.experimentRun).toEqual(before);
    expect(out.project.visibleRepairAttempts?.[0]?.status).toBe("reserved");expect(out.project.artifactAcceptance.attempts).toBe(1);
    expect(out.project.campaign.estimatedCost).toBe(x.project.campaign.estimatedCost);
    expect(ports.persistProject).not.toHaveBeenCalled();expect(ports.repairCandidate).not.toHaveBeenCalled();
  });
  it("requires the archive capability before claiming paid work",async()=>{
    const x=await reserved(),ports=execution(x);
    const out=await runServerVisibleRepair(x.project,{...ports,archiveRepairEvidence:undefined});
    expect(out.reason).toContain("归档能力不可用");expect(ports.repairCandidate).not.toHaveBeenCalled();expect(ports.persistProject).not.toHaveBeenCalled();
  });
  it("can explicitly resume the same reservation after archive recovery without another debit",async()=>{
    const x=await reserved(),ports=execution(x);
    ports.archiveRepairEvidence.mockRejectedValueOnce(Error("temporary archive failure"));
    const paused=await runServerVisibleRepair(x.project,ports);
    expect(paused.project.visibleRepairAttempts?.[0]?.status).toBe("reserved");expect(ports.repairCandidate).not.toHaveBeenCalled();
    const resumed=await runServerVisibleRepair({...paused.project,campaign:{...paused.project.campaign,status:"running",stopReason:undefined}},ports);
    expect(resumed.repaired).toBe(true);expect(resumed.project.visibleRepairAttempts).toHaveLength(1);
    expect(resumed.project.visibleRepairAttempts?.[0]?.id).toBe(x.project.visibleRepairAttempts?.[0]?.id);
    expect(resumed.project.artifactAcceptance.attempts).toBe(1);expect(ports.persistProject).toHaveBeenCalledOnce();expect(ports.repairCandidate).toHaveBeenCalledOnce();
  });
  it("rechecks the original deadline after evidence archive I/O",async()=>{
    const x=await reserved(),ports=execution(x),at=Date.now(),clock=vi.spyOn(Date,"now"),archive=ports.archiveRepairEvidence.getMockImplementation()!;
    try{
      ports.archiveRepairEvidence.mockImplementation(async input=>{const ref=await archive(input);clock.mockReturnValue(at+31*60000);return ref;});
      const out=await runServerVisibleRepair(x.project,ports);
      expect(out.reason).toContain("最长运行时间");expect(out.project.experimentRun).toEqual(x.project.experimentRun);
      expect(ports.repairCandidate).not.toHaveBeenCalled();expect(ports.persistProject).not.toHaveBeenCalled();
    }finally{clock.mockRestore();}
  });
  it("keeps v1 inline storage readable while requiring a reference for started v2 rows",async()=>{
    const x=await reserved(),record=x.project.visibleRepairAttempts![0]!;
    if(record.version!=="experiment-visible-repair-v2")throw Error("Expected v2 history");
    expect(VisibleRepairAttemptSchema.safeParse({...record,status:"running"}).success).toBe(false);
    expect(VisibleRepairAttemptSchema.safeParse({...record,experiment:x.project.experimentRun}).success).toBe(false);
    const legacy=VisibleRepairAttemptSchema.parse({...record,version:"experiment-visible-repair-v1",experiment:x.project.experimentRun});
    expect(legacy.version).toBe("experiment-visible-repair-v1");expect(legacy).toHaveProperty("experiment",x.project.experimentRun);
    expect(EvolveProjectSchema.parse({...x.project,visibleRepairAttempts:[legacy]}).visibleRepairAttempts?.[0]).toEqual(legacy);
  });
  it("rechecks the time window after a slow revision claim",async()=>{
    const x=await reserved(),ports=execution(x),at=Date.now(),clock=vi.spyOn(Date,"now");
    try{
      ports.persistProject.mockImplementation(async()=>{clock.mockReturnValue(at+31*60000);});
      expect((await runServerVisibleRepair(x.project,ports)).reason).toContain("最长运行时间");
      expect(ports.repairCandidate).not.toHaveBeenCalled();expect(ports.persistProject).toHaveBeenCalledOnce();
    }finally{clock.mockRestore();}
  });
  it("allows only the successful revision claimant to call AI under concurrent execution",async()=>{
    const x=await reserved(),ports=execution(x);let claimed=false;
    ports.persistProject.mockImplementation(async()=>{if(claimed)throw Error("revision conflict");claimed=true;});
    const results=await Promise.allSettled([runServerVisibleRepair(x.project,ports),runServerVisibleRepair(x.project,ports)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(ports.repairCandidate).toHaveBeenCalledOnce();
  });
  it("retains the frozen child on changed snapshot metadata without regenerating it",async()=>{
    const x=await reserved(),repaired=await runServerVisibleRepair(x.project,execution(x)),p=repaired.project;
    p.candidates=p.candidates.map(candidate=>candidate.id===x.prior.id?{...candidate,artifactSnapshots:candidate.artifactSnapshots.map(snapshot=>({...snapshot,content:snapshot.content+"tampered"}))}:candidate);
    const rebuild=vi.fn(async()=>x.current);
    const out=await runServerExperiment(p,{...x.ports,buildCandidate:rebuild});
    expect(out.control).toBe("stop");expect(rebuild).not.toHaveBeenCalled();expect(out.project.campaign.currentRound).toBe(0);
  });
  it("consumes failed calls and stops an interrupted running call without sending it again",async()=>{
    const x=await reserved(),ports=execution(x);ports.repairCandidate.mockRejectedValue(new Error("provider failed"));
    const out=await runServerVisibleRepair(x.project,ports);
    expect(out.project.artifactAcceptance.attempts).toBe(1);expect(out.project.visibleRepairAttempts?.[0]?.status).toBe("failed");
    const afterClaim=ports.persistProject.mock.calls[0]![0];ports.repairCandidate.mockClear();
    expect((await runServerVisibleRepair(afterClaim,ports)).reason).toContain("禁止自动重发");expect(ports.repairCandidate).not.toHaveBeenCalled();
  });
  it.each(["same-id","changed-final","missing-target","same-bytes"])("rejects a malformed %s repair without releasing it",async kind=>{
    const x=await reserved(),ports=execution(x);
    ports.repairCandidate.mockResolvedValue({...x.prior,id:kind==="same-id"?x.current.id:x.prior.id,
      finalHoldoutPaperHash:kind==="changed-final"?"wrong":x.project.finalHoldout!.paperHash,
      artifactSnapshots:kind==="missing-target"?[]:kind==="same-bytes"?x.current.artifactSnapshots:x.prior.artifactSnapshots});
    const out=await runServerVisibleRepair(x.project,ports);expect(out.repaired).toBe(false);expect(out.control).toBe("stop");
    expect(out.project.visibleRepairAttempts?.[0]?.status).toBe("failed");expect(out.project.outputArtifacts).toHaveLength(0);
  });
});
