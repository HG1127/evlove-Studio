// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {EvolveProjectSchema,IndependentFinalEvidenceSchema,type Candidate,type EvolveProject,type RepairEvidenceArchiveInput} from "@evolution/contracts";
import {evidenceFingerprint,hiddenRepairFeedbackContext,materializeAcceptedChampionPackage} from "@evolution/core";
import {bindHiddenRepairFixture,hiddenRepairFixture} from "@evolution/testkit";
import {runServerArtifactAcceptance} from "./server-artifact-acceptance";
import {restoreServerExperimentCandidate} from "./server-experiment-recovery";
import {runServerExperiment} from "./server-experiment";
import {runServerHoldout} from "./server-holdout";
const fingerprint=async(s:string)=>createHash("sha256").update(s).digest("hex");
function fixture(mode:"relative"|"mixed"="relative"){
  const x=hiddenRepairFixture(mode),archives:string[]=[];
  const persistProject=vi.fn<(p:EvolveProject)=>Promise<void>>(async()=>undefined),repairCandidate=vi.fn(async()=>x.prior),verifyIndependentFinal=vi.fn();
  const verifyFrozenArtifacts=vi.fn(async({candidate}:{candidate:Candidate})=>({verified:candidate.artifactSnapshots.map(s=>s.frozenArtifact!),unavailable:[],failed:[]}));
  const archiveRepairEvidence=vi.fn(async(input:RepairEvidenceArchiveInput)=>{archives.push(input.content);return {version:"repair-evidence-reference-v1" as const,artifactId:"evidence-"+input.sha256,missionId:input.missionId,candidateId:input.candidateId,sha256:input.sha256,size:input.size,mimeType:"application/json" as const};});
  return {...x,archives,ports:{fingerprint,persistProject,repairCandidate,verifyFrozenArtifacts,verifyIndependentFinal,archiveRepairEvidence}};
}
describe("ordinary Hidden v2 shared repair",()=>{
  it.each(["relative","mixed"] as const)("archives and debits one %s scope before mutation, even if the old recommendation says release",async mode=>{
    const x=fixture(mode),expected=mode==="mixed"?["CONTENT","READABILITY"]:["READABILITY"];
    x.ports.repairCandidate.mockImplementation(async()=>{
      expect(x.ports.archiveRepairEvidence).toHaveBeenCalledOnce();expect(x.ports.persistProject).toHaveBeenCalledOnce();
      const p=x.ports.persistProject.mock.calls[0]![0];expect(p.artifactAcceptance.attempts).toBe(1);
      expect(hiddenRepairFeedbackContext(p,x.current,expected,1)?.comparisons[0]).toMatchObject({criterionId:"READABILITY",currentScore:89,baselineScore:90,absoluteMinimumPassed:true});
      return x.prior;
    });
    const out=await runServerArtifactAcceptance(x.p,x.ports);expect(out.repaired,out.reason).toBe(true);expect(out.accepted).toBe(false);
    expect(x.ports.repairCandidate).toHaveBeenCalledOnce();expect(x.ports.verifyIndependentFinal).not.toHaveBeenCalled();
    expect(out.project.artifactRepairAttempts![0]).toMatchObject({version:"artifact-targeted-repair-v2",status:"frozen",failedCriterionIds:expected,attempt:1});
    expect(JSON.parse(x.archives[0]!).validation.evaluation.criterionScores[1]).toMatchObject({score:89,pass:true});
    expect(JSON.stringify(x.archives)).not.toContain("FINAL-PRIVATE-UNSEEN");
    const loaded=EvolveProjectSchema.parse(out.project),verify=vi.fn(async()=>true),child=loaded.candidates.find(c=>c.id===x.prior.id)!;
    expect(await restoreServerExperimentCandidate(loaded,child,1,{fingerprint,verifyFrozenArtifact:verify})).toEqual(child);
    child.artifactSnapshots[0]!.content+="changed";
    await expect(restoreServerExperimentCandidate(loaded,child,1,{fingerprint,verifyFrozenArtifact:verify})).rejects.toThrow("禁止重新生成");
  });
  it("does not resend a running v2 claim after interruption or share a second slot with Visible",async()=>{
    const x=fixture();await runServerArtifactAcceptance(x.p,x.ports);
    const claimed=EvolveProjectSchema.parse(x.ports.persistProject.mock.calls[0]![0]);x.ports.repairCandidate.mockClear();
    const resumed=await runServerArtifactAcceptance(claimed,x.ports);expect(resumed.reason).toContain("禁止自动重发");expect(x.ports.repairCandidate).not.toHaveBeenCalled();
    const y=fixture();y.p.artifactAcceptance.attempts=1;
    expect((await runServerArtifactAcceptance(y.p,y.ports)).repaired).toBe(false);expect(y.ports.persistProject).not.toHaveBeenCalled();expect(y.ports.repairCandidate).not.toHaveBeenCalled();
  });
  it.each(["conflict","archive","safety","deadline","final-consumed","partial-pair"])("preserves all limits with %s",async kind=>{
    const x=fixture();
    if(kind==="conflict")x.ports.persistProject.mockRejectedValue(Error("revision conflict"));
    if(kind==="archive")x.ports.archiveRepairEvidence.mockRejectedValue(Error("unavailable"));
    if(kind==="safety")x.p.validationRun.evaluation!.safety="FAIL";
    if(kind==="deadline")x.p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();
    if(kind==="final-consumed")x.p.validationRun.independentFinal=IndependentFinalEvidenceSchema.parse({...x.p.validationRun,paperHash:x.p.finalHoldout!.paperHash,suite:x.p.finalHoldout!.suite,inputFingerprint:x.p.validationRun.evidenceFingerprint});
    if(kind==="partial-pair")x.p.validationRun.baselineRuns[0]!.verificationStatus="partial";
    const run=runServerArtifactAcceptance(x.p,x.ports);
    if(kind==="conflict")await expect(run).rejects.toThrow("revision conflict");else expect((await run).repaired).toBe(false);
    expect(x.ports.repairCandidate).not.toHaveBeenCalled();expect(x.ports.verifyIndependentFinal).not.toHaveBeenCalled();
  });
  it("runs the exact v2 child through complete Visible, Hidden, blind final and frozen-byte packaging",async()=>{
    const x=fixture();x.p.gates=[{id:"experiment-ready",status:"approved"},{id:"artifact-ready",status:"pending"},{id:"release-ready",status:"pending"}];
    bindHiddenRepairFixture(x.p,x.current);
    const repaired=await runServerArtifactAcceptance(x.p,x.ports);expect(repaired.repaired,repaired.reason).toBe(true);
    const score=(n:number,id:string)=>({accuracy:n,evidence:n,riskCoverage:90,completeness:n,safety:"PASS" as const,notes:[],failures:[],
      cases:[{testCaseId:id,accuracy:n,evidence:n,completeness:n,reason:"synthetic"}],criteria:["CONTENT","READABILITY"].map(criterionId=>({criterionId,score:n,pass:true,evidence:["synthetic observation"],gaps:[],testCaseIds:[id]}))});
    const build=vi.fn(async()=>{throw Error("no reconstruction of the frozen child");});
    const executeSemanticBatch=async({testCases}:{testCases:EvolveProject["evalSuite"]})=>({results:testCases.map(test=>({testCaseId:test.id,output:"synthetic observed body",trace:[]}))});
    const candidate={fingerprint,verifyFrozenArtifact:async()=>true,executeSemanticBatch,judge:async()=>score(99,"V1"),buildCandidate:build};
    const visible=await runServerExperiment(repaired.project,candidate);expect(visible.readyForHoldout,visible.reason).toBe(true);expect(build).not.toHaveBeenCalled();
    const source=x.p.sourceArtifacts[0]!,hidden=await runServerHoldout(visible.project,{candidate:{...candidate,judge:async()=>score(99,"H1")},current:{executeSemanticBatch,judge:async()=>score(90,"H1"),buildCurrentArtifactContext:async()=>[{id:source.id,artifactSha256:await fingerprint(source.textContent!),content:"original body",truncated:false,contextRepresentation:"complete-html-static-text-projection",originalChars:source.textContent!.length,projectionChars:13,excludes:["scripts","styles","visual-fidelity","runtime-behavior"]}]},releaseReview:async()=>({recommendation:"release",summary:"synthetic",reasons:[],risks:[],requiredChecks:[]})});
    const final=vi.fn(async()=>{const p=hidden.project,v=hidden.validation,c=p.candidates.find(c=>c.id===x.prior.id)!;return IndependentFinalEvidenceSchema.parse({...v,paperHash:p.finalHoldout!.paperHash,suite:p.finalHoldout!.suite,inputFingerprint:evidenceFingerprint(p,c),baselineSuiteIds:["F1"],runs:v.runs.map(r=>({...r,testCaseId:"F1"})),baselineRuns:v.baselineRuns.map(r=>({...r,testCaseId:"F1"})),evaluation:{...v.evaluation,criterionScores:v.evaluation!.criterionScores!.map(s=>({...s,testCaseIds:["F1"]}))},baselineEvaluation:{...v.baselineEvaluation,criterionScores:v.baselineEvaluation!.criterionScores!.map(s=>({...s,testCaseIds:["F1"]}))}});});
    const accepted=await runServerArtifactAcceptance(hidden.project,{...x.ports,verifyIndependentFinal:final});expect(accepted.accepted,accepted.reason).toBe(true);expect(final).toHaveBeenCalledOnce();expect(x.ports.repairCandidate).toHaveBeenCalledOnce();
    expect(accepted.project.artifactAcceptance.attempts).toBe(1);
    const primary=materializeAcceptedChampionPackage(accepted.project).find(o=>o.kind==="primary")!;
    expect(primary.content).toBe(x.prior.artifactSnapshots[0]!.content);expect(primary.frozenArtifact?.sha256).toBe(x.prior.artifactSnapshots[0]!.frozenArtifact!.sha256);
  });
});
