// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,ArtifactMetadataSchema,EvolutionJobSchema,SourceArtifactSchema,TestCaseSchema,type ArtifactStorePort,type SandboxHtmlNativeRequest,type SandboxHtmlNativeResponse} from "@evolution/contracts";
import {withServerControlExecution} from "./server-control-execution";
import {acceptedPackageFixture,htmlNativeEvidenceFixture} from "@evolution/testkit";
import {executeServerExperimentCandidate} from "@evolution/harness";
import {createServerHtmlNativeExecutor,executeServerHtmlNativeBatch} from "./server-html-native-execution";
import {serverHtmlNativeAuthorized} from "./server-html-native-consent";
import {HTML_NATIVE_LOCAL_UNAVAILABLE} from "@evolution/contracts";
import {sourceGroundedHtmlSearchSteps} from "@evolution/core";
import * as artifactRuntime from "./artifact-runtime";

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
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
function withSearchPlan(){
  const x=fixture();
  x.original='<html><head><style>.search-hidden{display:none}</style></head><body><input id="search"><span id="searchCount"></span><article class="slide-card" id="slide-2" data-search="intro">Intro</article><article class="slide-card" id="slide-3" data-search="end">End</article><script>search.addEventListener("input",()=>card.dataset.search.includes(search.value));</script></body></html>';
  Object.assign(x.source,{textContent:x.original,size:Buffer.byteLength(x.original)});
  Object.assign(x.metadata,{sha256:sha(x.original),sizeBytes:x.source.size});
  Object.assign(x.project.baselineRun.originalReferences![0]!,{sha256:sha(x.original),sizeBytes:x.source.size});
  x.blobs.set("original",new Blob([x.original]));x.response.observation.original.sha256=sha(x.original);
  x.test.browserSteps=sourceGroundedHtmlSearchSteps(x.original)!;x.test.tags=["source-grounded-html-assertions"];
  return x;
}
describe("Mission-authorized native HTML composition",()=>{
  it("stops local work before file access when champion binding is unsupported or the artifact port cannot initialize",async()=>{
    const x=fixture();x.project.experimentPolicy.nativeHtmlRuntime="local-browser-v1";
    vi.stubEnv("VERCEL","");vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS",x.project.id);
    const getStore=vi.spyOn(artifactRuntime,"getServerArtifactStore").mockImplementation(()=>{throw Error("private storage configuration");});
    Object.assign(x.project,{searchChampion:{}});
    expect((await executeServerHtmlNativeBatch({...x,testCases:[x.test],candidate:undefined}))[0]).toMatchObject({error:HTML_NATIVE_LOCAL_UNAVAILABLE});expect(getStore).not.toHaveBeenCalled();
    x.project.searchChampion=undefined;
    const result=await executeServerHtmlNativeBatch({...x,testCases:[x.test]});
    expect(result[0]).toMatchObject({error:HTML_NATIVE_LOCAL_UNAVAILABLE});expect(JSON.stringify(result)).not.toContain("private storage configuration");expect(getStore).toHaveBeenCalledOnce();
  });
  it("reports denied local execution without reading blobs or silently using the ordinary route",async()=>{
    const x=fixture();x.project.experimentPolicy.nativeHtmlRuntime="local-browser-v1";
    vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS","");
    const runs=await executeServerHtmlNativeBatch({...x,testCases:[x.test]});
    expect(runs[0]).toMatchObject({verificationStatus:"unverified",error:HTML_NATIVE_LOCAL_UNAVAILABLE});expect(runs[0]).not.toHaveProperty("nativeHtmlProof");
    expect(x.ports.artifacts.get).not.toHaveBeenCalled();
  });
  it("stops further sources and retains a local capability marker on an execution failure",async()=>{
    const x=fixture(),execute=vi.fn(async()=>{throw Error("private");});
    const runs=await createServerHtmlNativeExecutor({...x.ports,execute,unavailableCode:HTML_NATIVE_LOCAL_UNAVAILABLE})({...x,testCases:[x.test]});
    expect(runs[0]).toMatchObject({error:HTML_NATIVE_LOCAL_UNAVAILABLE,verificationStatus:"unverified"});expect(JSON.stringify(runs)).not.toContain("private");expect(execute).toHaveBeenCalledOnce();
  });
  it("binds payment unavailability to the exact physical Candidate and stops before another source",async()=>{
    const x=fixture(),before=structuredClone(x.candidate),other={...x.source,id:"other-source",storageRef:"other"};
    x.project.sourceArtifacts.push(other);x.project.acceptanceRubric.push({...x.project.acceptanceRubric[0]!,id:"SEM-CROSS-CONSISTENCY",artifactIds:[other.id]});
    const test2={...x.test,id:"other-case",criterionIds:["SEM-CROSS-CONSISTENCY"]};
    const execute=vi.fn(async():Promise<SandboxHtmlNativeResponse>=>({status:"unavailable",reason:"do not echo this private service detail",reasonCode:"payment-required"}));
    const runs=await createServerHtmlNativeExecutor({...x.ports,execute})({...x,testCases:[x.test,test2]});
    expect(execute).toHaveBeenCalledOnce();expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({testCaseId:x.test.id,artifactHash:sha(x.subject),verificationStatus:"unverified",error:"NATIVE_HTML_PAYMENT_REQUIRED"});
    expect(runs[0]).not.toHaveProperty("nativeHtmlProof");expect(JSON.stringify(runs)).not.toContain("private service detail");expect(x.candidate).toEqual(before);
  });
  it("does not start another native Sandbox if the Job was cancelled while reading the physical Original",async()=>{
    const x=fixture(),at="2026-10-27T00:00:00Z";
    let job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:x.project.id,type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:control",generation:1,attempts:1,priority:70,createdAt:at,updatedAt:at});
    x.ports.artifacts.get=async id=>{job={...job,status:"cancelled"};return x.blobs.get(id);};
    await expect(withServerControlExecution({missionId:x.project.id,controlJobId:job.id,requestedAt:at},async()=>job,()=>
      createServerHtmlNativeExecutor(x.ports)({project:x.project,testCases:[x.test],candidate:x.candidate})))
      .rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
    expect(x.ports.execute).not.toHaveBeenCalled();
  });
  it("executes both frozen search plans with the shared physical profile, without transmitting TestCase prose",async()=>{
    const x=withSearchPlan(),legacy={...x.test,id:"legacy",browserSteps:x.test.browserSteps!.filter((_,index)=>![3,4,9].includes(index))};
    const plain={...x.test,id:"plain",browserSteps:undefined};x.project.evalSuite=[x.test,legacy,plain];
    const assertions={schemaVersion:"source-grounded-browser-assertions-v1" as const,plans:[x.test.browserSteps!,legacy.browserSteps]};
    x.response.observation.browserAssertions=assertions as NonNullable<typeof x.response.observation.browserAssertions>;
    for(const subject of [x.response.observation.original,x.response.observation.subject])subject.checks.push(...assertions.plans.flatMap((plan,p)=>plan.map((_,s)=>({id:`declared-browser-${p}-${s}`,pass:true,tested:1,failed:0}))));
    const native=createServerHtmlNativeExecutor(x.ports);
    const runs=await executeServerExperimentCandidate(x.project,x.candidate,{executeNativeHtmlBatch:native,executeSemanticBatch:vi.fn(),judge:vi.fn()});
    expect(runs.map(run=>run.testCaseId)).toEqual([x.test.id,legacy.id,plain.id]);
    expect(runs.every(run=>run.verificationStatus==="verified")).toBe(true);
    expect(x.ports.execute).toHaveBeenCalledTimes(1);
    const request=x.ports.execute.mock.calls[0]![0];
    expect(request.browserAssertions).toEqual(assertions);
    expect(Object.keys(request)).toEqual(["original","subject","expectedOriginalSha256","expectedSubjectSha256","browserAssertions"]);
    expect(x.test.browserSteps).toHaveLength(12);expect(legacy.browserSteps).toHaveLength(9);
  });
  it.each(["physical-original","missing-receipt","altered-predicate"])("never substitutes the native profile for %s predicates",async kind=>{
    const x=withSearchPlan();
    if(kind==="physical-original"){
      const changed=x.original.replaceAll("slide-2","slide-9");x.blobs.set("original",new Blob([changed]));
      x.metadata.sha256=sha(changed);x.project.baselineRun.originalReferences![0]!.sha256=sha(changed);
    }
    if(kind==="altered-predicate")x.test.browserSteps![0]!.selector="#custom";
    const runs=await createServerHtmlNativeExecutor(x.ports)({...x,testCases:[x.test]});
    if(kind==="altered-predicate"){expect(runs).toEqual([]);expect(x.ports.execute).not.toHaveBeenCalled();}
    else expect(runs[0]).toMatchObject({verificationStatus:"unverified",error:"NATIVE_HTML_EXECUTION_UNAVAILABLE"});
    if(kind==="physical-original")expect(x.ports.execute).not.toHaveBeenCalled();
  });
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
