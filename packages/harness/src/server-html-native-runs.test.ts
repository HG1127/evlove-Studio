import {describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,TestCaseSchema} from "@evolution/contracts";
import {acceptedPackageFixture,htmlNativeEvidenceFixture} from "@evolution/testkit";
import {collectServerHtmlNativeRuns,bindServerHtmlNativeOriginalReferences} from "./server-html-native-runs";
import {executeServerExperimentCandidate} from "./server-experiment-runner";
import {executeServerCurrentArtifactSuite} from "./server-current-artifact-runner";

function fixture(){
  const {project,current:candidate}=acceptedPackageFixture(false),run=htmlNativeEvidenceFixture();
  run.nativeHtmlProof!.observation.original.sha256=run.artifactHash!;
  project.sourceArtifacts[0]!.id="source-html";
  candidate.artifactSnapshots[0]!.sourceArtifactId="source-html";
  candidate.artifactSnapshots[0]!.frozenArtifact!.sourceArtifactId="source-html";
  candidate.artifactSnapshots[0]!.frozenArtifact!.sha256="a".repeat(64);
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
  it.each(["duplicate","stale-file","wrong-source","missing-check"])("fails closed for %s returned evidence",async kind=>{
    const {project,candidate,run,test}=fixture();
    if(kind==="stale-file")candidate.artifactSnapshots[0]!.frozenArtifact!.sha256="f".repeat(64);
    if(kind==="wrong-source")run.nativeHtmlProof!.sourceArtifactId="other";
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
});
