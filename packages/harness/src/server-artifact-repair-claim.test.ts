import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {EvolveProjectSchema,IndependentFinalEvidenceSchema,TestCaseSchema,type EvolveProject,type Candidate,type RepairEvidenceArchiveInput} from "@evolution/contracts";
import {evidenceFingerprint,finalHoldoutContractFingerprint,finalHoldoutPaperHash,materializeAcceptedChampionPackage} from "@evolution/core";
import {acceptedPackageFixture} from "@evolution/testkit";
import {runServerArtifactAcceptance} from "./server-artifact-acceptance";
import {restoreServerExperimentCandidate} from "./server-experiment-recovery";
import {runServerExperiment} from "./server-experiment";
import {runServerHoldout} from "./server-holdout";

const fingerprint=async(wire:string)=>createHash("sha256").update(wire).digest("hex");
function fixture(){
  const x=acceptedPackageFixture(false),p=x.project,at=new Date().toISOString();
  p.acceptanceRubric=[{id:"CONTENT",title:"configuration",requirement:"concrete configuration",source:"user-command",weight:100,hardGate:true,
    judgeType:"llm",validationMethod:"semantic-judge",minScore:85,evidenceExpected:["measured"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}];
  p.evalSuite=[TestCaseSchema.parse({id:"V1",title:"visible",input:"visible configuration",expected:["concrete"],criterionIds:["CONTENT"]})];
  p.hiddenEvalSuite=[TestCaseSchema.parse({...p.evalSuite[0]!,id:"H1",hidden:true,input:"hidden regression"})];
  const suite=[TestCaseSchema.parse({...p.hiddenEvalSuite[0]!,id:"F1",input:"INDEPENDENT-SECRET"})];
  p.finalHoldout={round:1,suite,paperHash:finalHoldoutPaperHash(suite),contractFingerprint:finalHoldoutContractFingerprint(p),createdAt:at};
  x.current.finalHoldoutPaperHash=p.finalHoldout.paperHash;x.prior.finalHoldoutPaperHash=p.finalHoldout.paperHash;
  p.candidates=[x.current];p.selectedCandidateIds=[x.current.id];
  p.artifactAcceptance={...p.artifactAcceptance,status:"idle",attempts:0,maxRepairAttempts:2,hardGatePass:false,results:[],acceptedAt:undefined};
  p.validationRun={...p.validationRun,independentFinal:undefined,recommendation:"hold",evidenceFingerprint:evidenceFingerprint(p,x.current),
    evaluation:{...p.validationRun.evaluation!,rubricScore:50,criterionScores:[{criterionId:"CONTENT",score:50,pass:false,verificationStatus:"verified",evidence:["measured lack"],gaps:["missing configuration"],testCaseIds:["H1"]}]},
    baselineEvaluation:{...p.validationRun.baselineEvaluation!,criterionScores:[{criterionId:"CONTENT",score:80,pass:false,verificationStatus:"verified",evidence:["original"],gaps:[],testCaseIds:["H1"]}]}};
  p.campaign={...p.campaign,status:"running",currentRound:0,noImprovementRounds:0,estimatedCost:0,startedAt:at,
    stopCriteria:{...p.campaign.stopCriteria,maxRounds:1,patienceRounds:2,maxWallMinutes:30,maxEstimatedCost:100},checkpoint:{round:1,completedPhase:"validation",at}};
  const persistProject=vi.fn<(project:EvolveProject)=>Promise<void>>(async()=>undefined);
  const repairCandidate=vi.fn(async()=>x.prior);
  const verifyFrozenArtifacts=vi.fn(async({candidate}:{candidate:Candidate})=>({verified:candidate.artifactSnapshots.map(s=>s.frozenArtifact!),unavailable:[] as string[],failed:[] as string[]}));
  const archives=new Map<string,string>();
  const archiveRepairEvidence=vi.fn(async(input:RepairEvidenceArchiveInput)=>{archives.set(input.sha256,input.content);return {
    version:"repair-evidence-reference-v1" as const,artifactId:`evidence-${input.sha256}`,missionId:input.missionId,candidateId:input.candidateId,
    sha256:input.sha256,size:input.size,mimeType:"application/json" as const};});
  return {...x,p,archives,ports:{fingerprint,persistProject,repairCandidate,verifyFrozenArtifacts,archiveRepairEvidence}};
}

describe("Hidden repair durable claim",()=>{
  it("persists the shared debit before calling mutation AI",async()=>{
    const x=fixture();
    x.ports.repairCandidate.mockImplementation(async()=>{
      expect(x.ports.persistProject).toHaveBeenCalledOnce();
      expect(x.ports.persistProject.mock.calls[0]![0].artifactAcceptance.attempts).toBe(1);
      return x.prior;
    });
    const out=await runServerArtifactAcceptance(x.p,x.ports);
    expect(out.repaired,out.reason).toBe(true);
    expect(x.ports.persistProject).toHaveBeenCalledOnce();
    const stored=EvolveProjectSchema.parse(x.ports.persistProject.mock.calls[0]![0]);
    expect(stored.artifactRepairAttempts?.[0]).toMatchObject({status:"running",attempt:1,parentCandidateId:x.current.id,evidence:{candidateId:x.current.id}});
    expect(out.project.artifactRepairAttempts?.[0]).toMatchObject({status:"frozen",candidateId:x.prior.id,failedCriterionIds:["CONTENT"]});
    const report=JSON.parse(x.archives.get(out.project.artifactRepairAttempts![0]!.evidence.sha256)!);
    expect(report.validation).toEqual(stored.validationRun);
    expect(JSON.stringify(stored.artifactRepairAttempts)).not.toContain("INDEPENDENT-SECRET");
  });
  it("does not reissue a stored running invocation after a process interruption",async()=>{
    const x=fixture();await runServerArtifactAcceptance(x.p,x.ports);
    const claimed=EvolveProjectSchema.parse(x.ports.persistProject.mock.calls[0]![0]);
    x.ports.repairCandidate.mockClear();x.ports.persistProject.mockClear();
    const out=await runServerArtifactAcceptance(claimed,x.ports);
    expect(out.reason).toContain("禁止自动重发");expect(out.project.artifactAcceptance.attempts).toBe(1);
    expect(x.ports.repairCandidate).not.toHaveBeenCalled();expect(x.ports.persistProject).not.toHaveBeenCalled();
  });
  it("keeps an unknown legacy invocation pending even when its only slot was already debited",async()=>{
    const x=fixture();x.p.artifactAcceptance.maxRepairAttempts=1;await runServerArtifactAcceptance(x.p,x.ports);
    const claimed=EvolveProjectSchema.parse(x.ports.persistProject.mock.calls[0]![0]);x.ports.repairCandidate.mockClear();
    const out=await runServerArtifactAcceptance(claimed,x.ports);
    expect(out.reason).toContain("禁止自动重发");expect(out.project.artifactRepairAttempts![0]!.status).toBe("running");
    expect(out.project.campaign.currentRound).toBe(0);expect(x.ports.repairCandidate).not.toHaveBeenCalled();
  });
  it("does not invoke AI after a revision conflict, including concurrent claims",async()=>{
    const x=fixture();let claimed=false;
    x.ports.persistProject.mockImplementation(async()=>{if(claimed)throw Error("revision conflict");claimed=true;});
    const results=await Promise.allSettled([runServerArtifactAcceptance(x.p,x.ports),runServerArtifactAcceptance(x.p,x.ports)]);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);expect(x.ports.repairCandidate).toHaveBeenCalledOnce();
  });
  it.each(["writer","fingerprint","archive"])("does not call AI when the %s capability is absent",async kind=>{
    const x=fixture();
    const out=await runServerArtifactAcceptance(x.p,{...x.ports,...(kind==="writer"?{persistProject:undefined}:kind==="fingerprint"?{fingerprint:undefined}:{archiveRepairEvidence:undefined})});
    expect(out.control).toBe("stop");expect(out.project.artifactAcceptance.attempts).toBe(0);
    expect(x.ports.repairCandidate).not.toHaveBeenCalled();
  });
  it.each(["paper","paper-hash","consumed-final","safety","wall","budget","paused"])("blocks %s before spending another repair",async kind=>{
    const x=fixture();
    if(kind==="paper")x.p.finalHoldout=undefined;
    if(kind==="paper-hash")x.p.finalHoldout!.suite[0]!.input="changed paper";
    if(kind==="consumed-final")x.p.validationRun.independentFinal=IndependentFinalEvidenceSchema.parse({...x.p.validationRun,status:"completed",inputFingerprint:x.p.validationRun.evidenceFingerprint,
      paperHash:x.p.finalHoldout!.paperHash,suite:x.p.finalHoldout!.suite});
    if(kind==="safety")x.p.validationRun.evaluation!.safety="FAIL";
    if(kind==="wall")x.p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();
    if(kind==="budget")x.p.artifactAcceptance.attempts=2;
    if(kind==="paused")x.p.campaign.status="paused";
    const out=await runServerArtifactAcceptance(x.p,x.ports);
    expect(out.repaired).toBe(false);expect(x.ports.persistProject).not.toHaveBeenCalled();expect(x.ports.repairCandidate).not.toHaveBeenCalled();
  });
  it("rechecks the deadline after a slow claim and retains the consumed slot",async()=>{
    const x=fixture(),at=Date.now(),clock=vi.spyOn(Date,"now");
    try{
      x.ports.persistProject.mockImplementation(async()=>{clock.mockReturnValue(at+31*60000);});
      const out=await runServerArtifactAcceptance(x.p,x.ports);
      expect(out.reason).toContain("最长运行时间");expect(out.project.artifactAcceptance.attempts).toBe(1);
      expect(out.project.artifactRepairAttempts?.[0]?.status).toBe("failed");expect(x.ports.repairCandidate).not.toHaveBeenCalled();
    }finally{clock.mockRestore();}
  });
  it.each(["unavailable","wrong-sha","wrong-mission"])("does not charge AI repair when evidence archiving is %s",async kind=>{
    const x=fixture();
    if(kind==="unavailable")x.ports.archiveRepairEvidence.mockRejectedValue(Error("storage unavailable"));
    else x.ports.archiveRepairEvidence.mockImplementation(async input=>({version:"repair-evidence-reference-v1",artifactId:"evidence",missionId:kind==="wrong-mission"?"foreign":input.missionId,
      candidateId:input.candidateId,sha256:kind==="wrong-sha"?"0".repeat(64):input.sha256,size:input.size,mimeType:"application/json"}));
    const out=await runServerArtifactAcceptance(x.p,x.ports);
    expect(out.repaired).toBe(false);expect(out.project.artifactAcceptance.attempts).toBe(0);
    expect(x.ports.persistProject).not.toHaveBeenCalled();expect(x.ports.repairCandidate).not.toHaveBeenCalled();
  });
  it("retains failed calls and estimated cost, requiring an explicit resume for another permitted attempt",async()=>{
    const x=fixture();x.p.baselineRun.result!.averageCost=0.02;x.ports.repairCandidate.mockRejectedValue(Error("provider failed"));
    const first=await runServerArtifactAcceptance(x.p,x.ports);
    expect(first.project.artifactRepairAttempts?.[0]?.status).toBe("failed");expect(first.project.campaign.estimatedCost).toBeGreaterThan(0);
    expect(first.project.artifactAcceptance.attempts).toBe(1);
    await runServerArtifactAcceptance(first.project,x.ports);expect(x.ports.repairCandidate).toHaveBeenCalledTimes(1);
    const second=await runServerArtifactAcceptance({...first.project,campaign:{...first.project.campaign,status:"idle"}},x.ports);
    expect(second.project.artifactAcceptance.attempts).toBe(2);expect(second.project.artifactRepairAttempts).toHaveLength(2);
    await runServerArtifactAcceptance({...second.project,campaign:{...second.project.campaign,status:"idle"}},x.ports);
    expect(x.ports.repairCandidate).toHaveBeenCalledTimes(2);
  });
  it.each(["same-id","same-bytes","changed-final","missing-target","unreadable-child"])("rejects %s as a completed repair",async kind=>{
    const x=fixture();
    x.ports.repairCandidate.mockResolvedValue({...x.prior,id:kind==="same-id"?x.current.id:x.prior.id,
      finalHoldoutPaperHash:kind==="changed-final"?"other-paper":x.prior.finalHoldoutPaperHash,
      artifactSnapshots:kind==="missing-target"?[]:kind==="same-bytes"?x.current.artifactSnapshots:x.prior.artifactSnapshots});
    if(kind==="unreadable-child")x.ports.verifyFrozenArtifacts.mockImplementation(async({candidate})=>candidate.id===x.current.id
      ?{verified:candidate.artifactSnapshots.map(s=>s.frozenArtifact!),unavailable:[],failed:[]}
      :{verified:[],unavailable:["missing blob"],failed:[]});
    const out=await runServerArtifactAcceptance(x.p,x.ports);
    expect(out.repaired).toBe(false);expect(out.project.artifactRepairAttempts?.[0]?.status).toBe("failed");
    expect(out.project.artifactAcceptance.attempts).toBe(1);expect(out.project.outputArtifacts).toHaveLength(0);
    expect(out.project.validationRun.candidateId).toBe(x.current.id);
  });
  it("recovers only the exact child snapshots recorded after the Hidden repair",async()=>{
    const x=fixture(),out=await runServerArtifactAcceptance(x.p,x.ports),p=EvolveProjectSchema.parse(out.project);
    const child=p.candidates.find(candidate=>candidate.id===x.prior.id)!,verify=vi.fn(async()=>true);
    expect(await restoreServerExperimentCandidate(p,child,1,{fingerprint,verifyFrozenArtifact:verify})).toEqual(child);
    child.artifactSnapshots[0]!.content+="changed after freeze";verify.mockClear();
    await expect(restoreServerExperimentCandidate(p,child,1,{fingerprint,verifyFrozenArtifact:verify})).rejects.toThrow("禁止重新生成");
    expect(verify).not.toHaveBeenCalled();
  });
  it("reruns the claimed Hidden repair through Visible, Hidden, independent final and exact-byte packaging",async()=>{
    const x=fixture();
    x.p.gates=[{id:"experiment-ready",status:"approved"},{id:"artifact-ready",status:"pending"},{id:"release-ready",status:"pending"}];
    const score=(value:number,id:string)=>({accuracy:value,evidence:value,riskCoverage:90,completeness:value,safety:"PASS" as const,notes:[],failures:[],
      cases:[{testCaseId:id,accuracy:value,evidence:value,completeness:value,reason:"synthetic"}],
      criteria:[{criterionId:"CONTENT",score:value,pass:value>=85,evidence:["synthetic measured prose"],gaps:[],testCaseIds:[id]}]});
    x.p.baselineRun.result={...x.p.baselineRun.result!,rubricScore:80,criterionScores:[{...score(80,"V1").criteria[0]!,verificationStatus:"verified"}]};
    const repaired=await runServerArtifactAcceptance(x.p,x.ports);expect(repaired.repaired,repaired.reason).toBe(true);
    const build=vi.fn(async()=>{throw Error("cannot rebuild frozen repair");});
    const executeSemanticBatch=async({testCases}:{testCases:EvolveProject["evalSuite"]})=>({results:testCases.map(test=>({testCaseId:test.id,output:"synthetic measured prose",trace:[]}))});
    const candidate={fingerprint,verifyFrozenArtifact:async()=>true,executeSemanticBatch,judge:async()=>score(99,"V1"),buildCandidate:build};
    const visible=await runServerExperiment(repaired.project,candidate);
    expect(visible.readyForHoldout,visible.reason).toBe(true);expect(build).not.toHaveBeenCalled();
    const source=x.p.sourceArtifacts[0]!,hidden=await runServerHoldout(visible.project,{candidate:{...candidate,judge:async()=>score(99,"H1")},
      current:{executeSemanticBatch,judge:async()=>score(80,"H1"),buildCurrentArtifactContext:async()=>[{id:source.id,artifactSha256:await fingerprint(source.textContent!),
        content:"original input",truncated:false,contextRepresentation:"complete-html-static-text-projection",originalChars:source.textContent!.length,projectionChars:14,
        excludes:["scripts","styles","visual-fidelity","runtime-behavior"]}]},
      releaseReview:async()=>({recommendation:"release",summary:"synthetic",reasons:[],risks:[],requiredChecks:[]})});
    const final=vi.fn(async()=>{
      const p=hidden.project,v=hidden.validation;
      return IndependentFinalEvidenceSchema.parse({...v,paperHash:p.finalHoldout!.paperHash,suite:p.finalHoldout!.suite,inputFingerprint:evidenceFingerprint(p,p.candidates.find(c=>c.id===x.prior.id)!),
        baselineSuiteIds:["F1"],runs:v.runs.map(run=>({...run,testCaseId:"F1"})),baselineRuns:v.baselineRuns.map(run=>({...run,testCaseId:"F1"})),
        evaluation:{...v.evaluation,criterionScores:v.evaluation!.criterionScores!.map(s=>({...s,testCaseIds:["F1"]}))},
        baselineEvaluation:{...v.baselineEvaluation,criterionScores:v.baselineEvaluation!.criterionScores!.map(s=>({...s,testCaseIds:["F1"]}))}});
    });
    const accepted=await runServerArtifactAcceptance(hidden.project,{...x.ports,verifyIndependentFinal:final});
    expect(accepted.accepted,accepted.reason).toBe(true);expect(final).toHaveBeenCalledOnce();expect(x.ports.repairCandidate).toHaveBeenCalledOnce();
    expect(accepted.project.artifactAcceptance.attempts).toBe(1);
    const primary=materializeAcceptedChampionPackage(accepted.project).find(output=>output.kind==="primary")!;
    expect(primary.content).toBe(x.prior.artifactSnapshots[0]!.content);expect(primary.frozenArtifact?.sha256).toBe(x.prior.artifactSnapshots[0]!.frozenArtifact!.sha256);
    const report=JSON.parse(x.archives.get(accepted.project.artifactRepairAttempts![0]!.evidence.sha256)!);
    expect(report.validation.evaluation.criterionScores[0].pass).toBe(false);
  });
});
