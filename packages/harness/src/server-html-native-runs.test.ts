import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,TestCaseSchema,ValidationRunSchema} from "@evolution/contracts";
import {evidenceFingerprint} from "@evolution/core";
import {acceptedPackageFixture,htmlNativeEvidenceFixture} from "@evolution/testkit";
import {collectServerHtmlNativeRuns,bindServerHtmlNativeOriginalReferences,serverHtmlNativeRunsMatchOriginal} from "./server-html-native-runs";
import {executeServerExperimentCandidate} from "./server-experiment-runner";
import {executeServerCurrentArtifactSuite} from "./server-current-artifact-runner";
import {recoverableServerExperimentRuns,serverExperimentBuildCheckpoint,serverExperimentExecutionCheckpoint,serverExperimentObservationBinding} from "./server-experiment-recovery";
import {recoverableServerHoldout,serverHoldoutExecutionEvidenceFingerprint} from "./server-holdout-recovery";

function fixture(){
  const {project,current:candidate}=acceptedPackageFixture(false),run=htmlNativeEvidenceFixture();
  run.nativeHtmlProof!.observation.original.sha256=run.artifactHash!;
  project.sourceArtifacts[0]!.id="source-html";
  candidate.artifactSnapshots[0]!.sourceArtifactId="source-html";
  candidate.artifactSnapshots[0]!.frozenArtifact!.sourceArtifactId="source-html";
  candidate.artifactSnapshots[0]!.frozenArtifact!.sha256="a".repeat(64);
  project.baselineRun.originalReferences=[{schemaVersion:"original-artifact-reference-v1",missionId:project.id,
    sourceArtifactId:"source-html",blobId:"original",sha256:run.nativeHtmlProof!.observation.original.sha256,sizeBytes:100}];
  project.acceptanceRubric=[AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Protection",requirement:"Retain functionality",hardGate:true,validationMethod:"executable-test",artifactIds:["source-html"]})];
  const test=TestCaseSchema.parse({id:run.testCaseId,title:"Check protection",input:"Inspect",expected:["Retained"],criterionIds:["PROTECT-ALL"],executionMode:"external-runner",tags:["source-grounded-html-assertions"]});
  project.evalSuite=[test];
  return {project,candidate,run,test};
}
describe("injected native HTML execution",()=>{
  it.each(["missing","stale","duplicate","wrong-mission"])("cannot lock %s physical Original references using native observations",kind=>{
    const {run}=fixture(),ordered=new Map([[run.testCaseId,run]]);
    const reference={schemaVersion:"original-artifact-reference-v1" as const,missionId:"mission",sourceArtifactId:"source-html",blobId:"original",sha256:kind==="stale"?"f".repeat(64):run.artifactHash!,sizeBytes:100};
    bindServerHtmlNativeOriginalReferences(ordered,kind==="missing"?[]:kind==="duplicate"?[reference,reference]:[reference],kind==="wrong-mission"?"other":"mission");
    expect(ordered.get(run.testCaseId)).toMatchObject({verificationStatus:"unverified",error:"NATIVE_HTML_ORIGINAL_REFERENCE_MISMATCH"});
  });
  it("cannot substitute an Original-vs-Candidate comparison for an Original self-observation",async()=>{
    const {project,run,test}=fixture();run.nativeHtmlProof!.observation.original.sha256="e".repeat(64);
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:async()=>[run]})).get(test.id)?.verificationStatus).toBe("unverified");
  });
  it("preserves complete exact-file native evidence through candidate normalization and current-version execution",async()=>{
    const {project,candidate,run}=fixture(),semantic=vi.fn(),external=vi.fn();
    const ports={executeNativeHtmlBatch:vi.fn(async()=>[run]),executeSemanticBatch:semantic,executeExternalBatch:external,judge:vi.fn()};
    expect(await executeServerExperimentCandidate(project,candidate,ports)).toEqual([run]);
    expect(await executeServerCurrentArtifactSuite(project,project.evalSuite,ports)).toEqual([run]);
    expect(semantic).not.toHaveBeenCalled();expect(external).not.toHaveBeenCalled();
  });
  it("binds a changed Candidate to the independently locked Original, rather than requiring both file hashes to match",async()=>{
    const {project,candidate,run,test}=fixture();
    const originalSha="e".repeat(64);
    run.nativeHtmlProof!.observation.original.sha256=originalSha;
    project.baselineRun.originalReferences![0]!.sha256=originalSha;
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:async()=>[run]},candidate)).get(test.id)).toEqual(run);
  });
  it.each(["missing","duplicate","wrong-mission","wrong-source","stale-hash","malformed-reference"])("rejects %s locked Original references for Candidate and current-version execution",async kind=>{
    const {project,candidate,run,test}=fixture(),references=project.baselineRun.originalReferences!;
    if(kind==="missing")project.baselineRun.originalReferences=undefined;
    if(kind==="duplicate")references.push({...references[0]!});
    if(kind==="wrong-mission")references[0]!.missionId="other-mission";
    if(kind==="wrong-source")references[0]!.sourceArtifactId="other-source";
    if(kind==="stale-hash")references[0]!.sha256="f".repeat(64);
    if(kind==="malformed-reference")references[0]!.sizeBytes=0;
    const semantic=vi.fn(),external=vi.fn(),ports={executeNativeHtmlBatch:async()=>[run],executeSemanticBatch:semantic,executeExternalBatch:external,judge:vi.fn()};
    const expected={verificationStatus:"unverified",error:"NATIVE_HTML_ORIGINAL_REFERENCE_MISMATCH"};
    expect((await executeServerExperimentCandidate(project,candidate,ports,[test]))[0]).toMatchObject(expected);
    expect((await executeServerCurrentArtifactSuite(project,[test],ports))[0]).toMatchObject(expected);
    expect(semantic).not.toHaveBeenCalled();expect(external).not.toHaveBeenCalled();
  });
  it("rejects an otherwise complete Candidate observation measured against a different Original",async()=>{
    const {project,candidate,run,test}=fixture();
    run.nativeHtmlProof!.observation.original.sha256="f".repeat(64);
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:async()=>[run]},candidate)).get(test.id))
      .toMatchObject({verificationStatus:"unverified",error:"NATIVE_HTML_ORIGINAL_REFERENCE_MISMATCH"});
  });
  it("preserves complete measured code-loss evidence instead of replacing it with an unavailable capability",async()=>{
    const {project,candidate,run,test}=fixture(),observation=run.nativeHtmlProof!.observation;
    observation.originalCodeBlocksRetained=false;
    observation.codeBlockRetention={policy:"original-text-with-numbered-instruction-append-v1",originalCount:57,retainedCount:55,
      exactCount:55,extendedInstructionCount:0,retained:false};
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:async()=>[run]},candidate)).get(test.id)).toEqual(run);
    expect(serverHtmlNativeRunsMatchOriginal(project,[run],candidate)).toBe(true);
  });
  it("does not reuse a physically bound, correctly digested Experiment checkpoint containing the wrong Original",async()=>{
    const {project,candidate,run}=fixture(),at=Date.parse("2026-10-26T01:00:00.000Z");
    candidate.artifactBuildStatus="ready";
    project.experimentRun={...project.experimentRun,status:"failed",id:"experiment-r1-server",summary:"[server-campaign-experiment-judge-pending] Judge unavailable"};
    const ports={fingerprint:async(value:string)=>createHash("sha256").update(value).digest("hex"),readExecutionArtifactFingerprint:async()=>"b".repeat(64)};
    const built=await serverExperimentBuildCheckpoint(project,candidate,ports);
    expect(built).toBeDefined();
    const binding=await serverExperimentObservationBinding(project,candidate,built,ports);
    const checkpoint=await serverExperimentExecutionCheckpoint(project,candidate,built,[run],at,ports,binding);
    expect(await recoverableServerExperimentRuns(project,candidate,1,checkpoint,at+1000,ports)).toEqual([run]);
    run.nativeHtmlProof!.observation.original.sha256="f".repeat(64);
    const invalid=await serverExperimentExecutionCheckpoint(project,candidate,built,[run],at,ports,binding);
    expect(await recoverableServerExperimentRuns(project,candidate,1,invalid,at+1000,ports)).toBeUndefined();
  });
  it.each(["candidate","baseline"])("does not reuse a digest-consistent holdout when its %s observation loses the locked Original binding",arm=>{
    const {project,candidate,run,test}=fixture(),at=Date.parse("2026-10-26T01:00:00.000Z");
    project.validationRun=ValidationRunSchema.parse({id:"validation-server-r1",status:"completed",validationMode:"full",candidateId:candidate.id,
      summary:"[server-campaign-holdout-review-pending] Review unavailable",evidenceFingerprint:evidenceFingerprint(project,candidate),
      baselineContextFingerprint:"baseline",executionArtifactFingerprint:"b".repeat(64),baselineObservedAt:at,
      plannedCases:1,executedCases:1,baselineSuiteIds:[test.id],runs:[structuredClone(run)],baselineRuns:[structuredClone(run)],checks:[]});
    const prior=project.validationRun;
    prior.executionEvidenceFingerprint=serverHoldoutExecutionEvidenceFingerprint(prior);
    expect(recoverableServerHoldout(project,candidate,[test],1,"baseline","b".repeat(64),at+1000)).toEqual(prior);
    const altered=arm==="candidate"?prior.runs:prior.baselineRuns;
    altered[0]!.nativeHtmlProof!.observation.original.sha256="f".repeat(64);
    prior.executionEvidenceFingerprint=serverHoldoutExecutionEvidenceFingerprint(prior);
    expect(recoverableServerHoldout(project,candidate,[test],1,"baseline","b".repeat(64),at+1000)).toBeUndefined();
  });
  it("treats legacy runs without native proofs as unchanged, but rejects malformed native proof data on reuse",()=>{
    const {project,run}=fixture();
    expect(serverHtmlNativeRunsMatchOriginal(project,[run])).toBe(true);
    run.nativeHtmlProof=undefined;
    expect(serverHtmlNativeRunsMatchOriginal(project,[run])).toBe(true);
    Object.assign(run,{nativeHtmlProof:{sourceArtifactId:"source-html"}});
    expect(serverHtmlNativeRunsMatchOriginal(project,[run])).toBe(false);
  });
  it.each(["duplicate","stale-file","wrong-source","wrong-receipt-source","missing-check"])("fails closed for %s returned evidence",async kind=>{
    const {project,candidate,run,test}=fixture();
    if(kind==="stale-file")candidate.artifactSnapshots[0]!.frozenArtifact!.sha256="f".repeat(64);
    if(kind==="wrong-source")run.nativeHtmlProof!.sourceArtifactId="other";
    if(kind==="wrong-receipt-source")candidate.artifactSnapshots[0]!.frozenArtifact!.sourceArtifactId="other";
    if(kind==="missing-check")run.nativeHtmlProof!.observation.subject.checks.shift();
    const ports={executeNativeHtmlBatch:async()=>kind==="duplicate"?[run,run]:[run]};
    const results=await collectServerHtmlNativeRuns(project,[test],ports,candidate);
    expect(results.get(test.id)).toMatchObject({verificationStatus:"unverified",error:"NATIVE_HTML_EVIDENCE_INVALID"});
  });
  it("retains the ordinary execution route when a profile or execution port is unavailable",async()=>{
    const {project,candidate,test}=fixture();
    expect((await collectServerHtmlNativeRuns(project,[test],{},candidate)).size).toBe(0);
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:async()=>[]},candidate)).size).toBe(0);
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:async()=>{throw Error("unavailable");}},candidate)).size).toBe(0);
  });
  it("does not replace original-vs-candidate pairwise or explicit manual review with original self-observation",async()=>{
    const {project,test,run}=fixture(),execute=vi.fn(async()=>[run]);
    project.acceptanceRubric[0]!.id="SYS-PAIRWISE";test.criterionIds=["SYS-PAIRWISE"];
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:execute})).size).toBe(0);
    project.acceptanceRubric[0]!.validationMethod="manual-review";
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:execute},fixture().candidate)).size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
  it("retains explicit browser steps on their ordinary execution route instead of treating fixed native checks as those steps",async()=>{
    const {project,candidate,test}=fixture(),execute=vi.fn();
    test.browserSteps=[{action:"text",selector:"#custom-user-control",value:"required custom state"}];
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:execute},candidate)).size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
  it("uses complete native observations for protected structural cases while keeping unrelated static cases separate",async()=>{
    const {project,candidate,test,run}=fixture(),execute=vi.fn(async()=>[run]);
    test.executionMode="static-evidence";test.criterionIds=["ART-1-STRUCTURE"];project.acceptanceRubric[0]!.id="ART-1-STRUCTURE";
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:execute},candidate)).get(test.id)).toEqual(run);
    test.criterionIds=["OTHER-STATIC"];project.acceptanceRubric[0]!.id="OTHER-STATIC";
    expect((await collectServerHtmlNativeRuns(project,[test],{executeNativeHtmlBatch:execute},candidate)).size).toBe(0);
  });
});
