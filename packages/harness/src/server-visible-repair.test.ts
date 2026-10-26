import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {EvolveProjectSchema,IndependentFinalEvidenceSchema,TestCaseSchema,type EvolveProject,type EvaluateAiResult} from "@evolution/contracts";
import {evidenceFingerprint,finalHoldoutContractFingerprint,finalHoldoutPaperHash,materializeAcceptedChampionPackage,visibleRepairTarget} from "@evolution/core";
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
  const ports={fingerprint,verifyFrozenArtifact,buildCandidate:vi.fn(async()=>x.current),
    executeSemanticBatch:async()=>({results:[]}),judge:async()=>judge(50)};
  return {...x,p,ports};
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
  it("keeps legacy missions unchanged and preserves a reservation through the storage schema",async()=>{
    const x=fixture();delete x.p.experimentPolicy.visibleFailureRepair;
    const legacy=await runServerExperiment(x.p,x.ports);
    expect(legacy.readyForVisibleRepair).toBeUndefined();expect(legacy.project.campaign.currentRound).toBe(1);
    expect(legacy.project.visibleRepairAttempts).toBeUndefined();expect(legacy.project.artifactAcceptance.attempts).toBe(0);
    const fresh=await reserved(),stored=EvolveProjectSchema.parse(fresh.project);
    expect(stored.visibleRepairAttempts?.[0]).toMatchObject({status:"reserved",attempt:1,parentCandidateId:fresh.current.id});
    expect(stored.visibleRepairAttempts?.[0]?.experiment).toEqual(stored.experimentRun);
    expect(stored.artifactAcceptance.attempts).toBe(1);expect(stored.campaign.currentRound).toBe(0);
    expect(hasServerPendingVisibleRepair(stored)).toBe(true);expect(hasServerFrozenValidationCheckpoint(stored)).toBe(true);
    expect(await prepareServerVisibleRepair(stored,fresh.ports,new Date().toISOString())).toBeUndefined();
  });
  it("persists a claim before AI, preserves failure evidence, and measures the exact child before Hidden",async()=>{
    const x=await reserved(),ports=execution(x),old=structuredClone(x.project.visibleRepairAttempts![0]!.experiment);
    ports.repairCandidate.mockImplementation(async()=>{
      expect(ports.persistProject).toHaveBeenCalledOnce();
      expect(ports.persistProject.mock.calls[0]![0].visibleRepairAttempts?.[0]?.status).toBe("running");
      return {...x.prior,finalHoldoutPaperHash:x.project.finalHoldout!.paperHash};
    });
    const repaired=await runServerVisibleRepair(EvolveProjectSchema.parse(x.project),ports);
    expect(repaired.repaired).toBe(true);expect(repaired.project.campaign.currentRound).toBe(0);
    expect(repaired.project.artifactAcceptance).toMatchObject({status:"repairing",attempts:1,hardGatePass:false});
    expect(repaired.project.campaign.estimatedCost).toBeGreaterThanOrEqual(x.project.campaign.estimatedCost);
    expect(repaired.project.visibleRepairAttempts?.[0]).toMatchObject({status:"frozen",parentCandidateId:x.current.id,candidateId:x.prior.id,experiment:old});
    expect(repaired.project.finalHoldout).toEqual(x.project.finalHoldout);
    const rebuild=vi.fn(async()=>{throw Error("must not regenerate frozen child");});
    const measured=await runServerExperiment(repaired.project,{...x.ports,buildCandidate:rebuild,judge:async()=>judge(95)});
    expect(rebuild).not.toHaveBeenCalled();expect(measured.readyForHoldout).toBe(true);
    expect(measured.winnerId).toBe(x.prior.id);expect(measured.project.outputArtifacts).toHaveLength(0);
    expect(measured.project.validationRun.status).toBe("idle");expect(measured.project.artifactAcceptance.status).not.toBe("passed");
    expect(measured.project.visibleRepairAttempts?.[0]?.experiment).toEqual(old);
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
  it.each(["contract","counter","paper","blob","expired"])("blocks changed %s before paid I/O",async kind=>{
    const x=await reserved(),ports=execution(x),p=structuredClone(x.project);
    if(kind==="contract")p.evolutionCommand="different command";
    if(kind==="counter")p.artifactAcceptance.attempts=0;
    if(kind==="paper")p.finalHoldout!.suite[0]!.expected=["changed secret"];
    if(kind==="blob")ports.verifyFrozenArtifact.mockResolvedValue(false);
    if(kind==="expired")p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();
    const out=await runServerVisibleRepair(p,ports);expect(out.control).toBe("stop");
    expect(ports.repairCandidate).not.toHaveBeenCalled();expect(ports.persistProject).not.toHaveBeenCalled();
  });
  it("never calls the provider when the revision claim conflicts",async()=>{
    const x=await reserved(),ports=execution(x);ports.persistProject.mockRejectedValue(new Error("revision conflict"));
    await expect(runServerVisibleRepair(x.project,ports)).rejects.toThrow("revision conflict");expect(ports.repairCandidate).not.toHaveBeenCalled();
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
