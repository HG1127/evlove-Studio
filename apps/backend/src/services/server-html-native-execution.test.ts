// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,ArtifactMetadataSchema,SourceArtifactSchema,TestCaseSchema,type ArtifactStorePort,type SandboxHtmlNativeRequest} from "@evolution/contracts";
import {acceptedPackageFixture,htmlNativeEvidenceFixture} from "@evolution/testkit";
import {executeServerExperimentCandidate} from "@evolution/harness";
import {createServerHtmlNativeExecutor,executeServerHtmlNativeBatch} from "./server-html-native-execution";
import {serverHtmlNativeAuthorized} from "./server-html-native-consent";

const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
function fixture(){
  const {project,current:candidate}=acceptedPackageFixture(false),run=htmlNativeEvidenceFixture();
  const original="<html><body>original</body></html>",subject="<html><body>improved</body></html>";
  const source=SourceArtifactSchema.parse({id:"source-html",name:"guide.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",
    size:Buffer.byteLength(original),inputMode:"upload",storageRef:"original",parseStatus:"ready",createdAt:"2026-10-26T00:00:00.000Z"});
  project.sourceArtifacts=[source];project.searchChampion=undefined;
  project.acceptanceRubric=[AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Protect",requirement:"Retain behavior",hardGate:true,validationMethod:"executable-test",artifactIds:[source.id]})];
  const test=TestCaseSchema.parse({id:"native-case",title:"Protect",input:"Inspect",expected:["Retained"],criterionIds:["PROTECT-ALL"],executionMode:"external-runner"});
  project.evalSuite=[test];
  project.baselineRun.originalReferences=[{schemaVersion:"original-artifact-reference-v1",missionId:project.id,sourceArtifactId:source.id,blobId:"original",sha256:sha(original),sizeBytes:source.size}];
  const old=candidate.artifactSnapshots[0]!;
  candidate.artifactSnapshots=[{...old,sourceArtifactId:source.id,content:subject,contentHash:sha(subject),name:source.name,mimeType:source.mimeType,
    frozenArtifact:{...old.frozenArtifact!,sourceArtifactId:source.id,blobId:"candidate",sha256:sha(subject),snapshotHash:sha(subject),size:Buffer.byteLength(subject),name:source.name,mimeType:source.mimeType}}];
  const metadata=ArtifactMetadataSchema.parse({schemaVersion:"artifact-v1",id:"original",missionId:project.id,kind:"source",bucket:"artifacts",objectPath:"original",
    mimeType:source.mimeType,sizeBytes:source.size,sha256:sha(original),createdAt:source.createdAt,updatedAt:source.createdAt});
  const blobs=new Map([["original",new Blob([original])],["candidate",new Blob([subject])]]);
  const get=vi.fn(async(id:string)=>blobs.get(id)),getMetadata=vi.fn(async()=>metadata);
  const artifacts={get,getMetadata,put:vi.fn(),delete:vi.fn()} as unknown as ArtifactStorePort;
  const observation=run.nativeHtmlProof!.observation;
  observation.original.sha256=sha(original);observation.subject.sha256=sha(subject);
  const response={status:"observed" as const,observation,subjectText:run.renderedDocumentEvidence!.text};
  const execute=vi.fn(async(request:SandboxHtmlNativeRequest)=>{void request;return response;}),verifyFrozen=vi.fn(async()=>true),authorized=vi.fn(()=>true);
  const ports={artifacts,execute,verifyFrozen,authorized};
  return {project,candidate,test,source,original,subject,metadata,blobs,ports,response};
}
afterEach(()=>vi.unstubAllEnvs());
describe("Mission-authorized native HTML composition",()=>{
  it("is off by default and never reads files or creates a VM without the exact Mission opt-in",async()=>{
    const x=fixture();x.ports.authorized.mockReturnValue(false);
    expect(await createServerHtmlNativeExecutor(x.ports)({...x,testCases:[x.test]})).toEqual([]);
    expect(x.ports.artifacts.get).not.toHaveBeenCalled();expect(x.ports.execute).not.toHaveBeenCalled();
    vi.stubEnv("EVOLUTION_HTML_NATIVE_MISSIONS","");
    expect(serverHtmlNativeAuthorized(x.project.id)).toBe(false);
    expect(await executeServerHtmlNativeBatch({...x,testCases:[x.test]})).toEqual([]);
    vi.stubEnv("EVOLUTION_HTML_NATIVE_MISSIONS",x.project.id);
    expect(serverHtmlNativeAuthorized(x.project.id)).toBe(true);expect(serverHtmlNativeAuthorized(x.project.id+"-other")).toBe(false);
    vi.stubEnv("EVOLUTION_HTML_NATIVE_MISSIONS","invalid mission id");expect(serverHtmlNativeAuthorized(x.project.id)).toBe(false);
  });
  it("runs one exact physical pair per suite, binds each test, and preserves a complete native failure",async()=>{
    const x=fixture(),test2={...x.test,id:"native-second"};
    const failed=x.response.observation.subject.checks.find(check=>check.id==="search-positive")!;
    failed.pass=false;x.response.observation.subject.failures=[failed.id];
    const executeNativeHtmlBatch=createServerHtmlNativeExecutor(x.ports);
    const results=new Map((await executeServerExperimentCandidate(x.project,x.candidate,{executeNativeHtmlBatch,executeSemanticBatch:vi.fn(),judge:vi.fn()},[x.test,test2])).map(run=>[run.testCaseId,run]));
    expect(x.ports.execute).toHaveBeenCalledTimes(1);
    expect(x.ports.execute.mock.calls[0]![0]).toMatchObject({original:new TextEncoder().encode(x.original),subject:new TextEncoder().encode(x.subject),expectedOriginalSha256:sha(x.original),expectedSubjectSha256:sha(x.subject)});
    expect([...results.keys()]).toEqual([x.test.id,test2.id]);
    for(const [id,run] of results){expect(run.nativeHtmlProof?.testCaseId).toBe(id);expect(run.nativeHtmlProof?.observation.subject.failures).toEqual([failed.id]);}
    expect(results.get(x.test.id)?.renderedDocumentEvidence?.excludes).toEqual(["scripts","styles","raw-attributes"]);
  });
  it.each(["mission","source-sha","source-size","source-kind","locked-original","missing-reference","candidate-sha","candidate-receipt-source"])("does not transmit subjects after %s identity failure",async kind=>{
    const x=fixture();
    if(kind==="mission")x.metadata.missionId="other";
    if(kind==="source-sha")x.metadata.sha256="f".repeat(64);
    if(kind==="source-size")x.metadata.sizeBytes++;
    if(kind==="source-kind")x.metadata.kind="candidate";
    if(kind==="locked-original")x.project.baselineRun.originalReferences![0]!.sha256="f".repeat(64);
    if(kind==="missing-reference")x.project.baselineRun.originalReferences=undefined;
    if(kind==="candidate-sha")x.candidate.artifactSnapshots[0]!.frozenArtifact!.sha256="f".repeat(64);
    if(kind==="candidate-receipt-source")x.candidate.artifactSnapshots[0]!.frozenArtifact!.sourceArtifactId="other";
    const runs=await createServerHtmlNativeExecutor(x.ports)({...x,testCases:[x.test]});
    expect(runs[0]).toMatchObject({verificationStatus:"unverified",error:"NATIVE_HTML_EXECUTION_UNAVAILABLE"});
    expect(x.ports.execute).not.toHaveBeenCalled();
  });
  it("supports initial Baseline self-observation without inventing a locked reference or reading a Candidate",async()=>{
    const x=fixture();x.project.baselineRun.originalReferences=undefined;
    x.response.observation.subject.sha256=sha(x.original);
    const runs=await createServerHtmlNativeExecutor(x.ports)({project:x.project,testCases:[x.test]});
    expect(runs[0]?.artifactHash).toBe(sha(x.original));expect(x.ports.verifyFrozen).not.toHaveBeenCalled();
    expect(x.ports.execute.mock.calls[0]![0]).toMatchObject({expectedOriginalSha256:sha(x.original),expectedSubjectSha256:sha(x.original)});
    expect(x.project.baselineRun.originalReferences).toBeUndefined();
  });
  it("rejects wrong-subject responses before returning rendered evidence",async()=>{
    const x=fixture();x.response.observation.subject.sha256="f".repeat(64);
    expect((await createServerHtmlNativeExecutor(x.ports)({...x,testCases:[x.test]}))[0]).toMatchObject({verificationStatus:"unverified",error:"NATIVE_HTML_EXECUTION_UNAVAILABLE"});
  });
});
