// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,EvolutionJobSchema,type HtmlProtectionAuthorityReference,type HtmlProtectionEvidence,type HtmlProtectionObligation,type HtmlProtectionProof,type HtmlProtectionProofBinding,type ArtifactMetadata,type ArtifactStorePort} from "@evolution/contracts";
import {HTML_PROTECTION_AUTHORITY_POLICY,createHtmlProtectionAuthority,evidenceFingerprint} from "@evolution/core";
import {acceptedPackageFixture} from "@evolution/testkit";
import {readServerHtmlProtectionAcceptedFile,restoreServerHtmlProtectionAcceptedProject,type ServerHtmlProtectionAcceptedPorts} from "./server-html-protection-accepted-authority";
import {assertServerHtmlProtectionOwner} from "./server-html-protection-authority-owner";
function fixture(){
  const f=acceptedPackageFixture(false),metadata=new Map<string,ArtifactMetadata>();f.blobs.set("source",new Blob([f.project.sourceArtifacts[0]!.textContent!],{type:"text/html"}));
  for(const[id,blob]of f.blobs){const text=id==="source"?f.project.sourceArtifacts[0]!.textContent!:f.project.candidates.find(c=>c.artifactSnapshots[0]?.frozenArtifact?.blobId===id)!.artifactSnapshots[0]!.content;
    metadata.set(id,{id,schemaVersion:"artifact-v1",missionId:f.project.id,bucket:"private",objectPath:id,mimeType:blob.type,sizeBytes:blob.size,sha256:createHash("sha256").update(text).digest("hex"),createdAt:"2026-10-14T12:00:00Z",updatedAt:"2026-10-14T12:00:00Z"});}
  const stored=structuredClone(f.project),store:ArtifactStorePort={...f.store,getMetadata:async id=>structuredClone(metadata.get(id))};
  const ports:ServerHtmlProtectionAcceptedPorts={store,readMission:vi.fn(async()=>structuredClone(stored)),restore:vi.fn(async()=>undefined)};
  const args={project:f.project,candidateId:f.current.id,sourceArtifactId:"source"};return {...f,stored,metadata,ports,args};
}
describe("private accepted file boundary (controlled local fixture, no whole protection claim)",()=>{
  it("returns the identical pre-existing frozen bytes and digest after complete target and metadata reads",async()=>{
    const f=fixture(),result=await readServerHtmlProtectionAcceptedFile(f.args,f.ports),receipt=f.current.artifactSnapshots[0]!.frozenArtifact!;
    expect(new TextDecoder().decode(result.bytes)).toBe(f.current.artifactSnapshots[0]!.content);expect(result.identity).toMatchObject({blobId:receipt.blobId,sha256:receipt.sha256,size:receipt.size,candidateId:f.current.id,validationId:f.project.validationRun.id});
    expect(f.ports.restore).not.toHaveBeenCalled();
  });
  it("refuses a whole HTML acceptance even when public PASS/high scores exist but independent references are missing",async()=>{
    const f=fixture();f.project.acceptanceRubric=[AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"All original content",requirement:"Preserve all original content and behavior",source:"protected-item",protectedConstraint:true,hardGate:true,minScore:95,artifactIds:["source"]})];
    f.project.hiddenEvalSuite[0]!.criterionIds=["PROTECT-ALL"];const binding=evidenceFingerprint(f.project,f.current);f.project.validationRun.evidenceFingerprint=binding;f.project.artifactAcceptance.evidenceFingerprint=binding;Object.assign(f.stored,structuredClone(f.project));
    await expect(restoreServerHtmlProtectionAcceptedProject(f.args,f.ports)).rejects.toThrow("reference-missing");expect(f.ports.restore).not.toHaveBeenCalled();
  });
  it.each(["candidate","hidden","gate-f","paper","baseline","route","source","output"] as const)("rejects %s change during accepted context readback",async kind=>{
    const f=fixture();let reads=0;f.ports.readMission=async()=>{if(++reads===2){
      if(kind==="candidate")f.stored.candidates[0]!.artifactSnapshots[0]!.content+="changed";if(kind==="hidden")f.stored.validationRun.runs[0]!.output+="changed";
      if(kind==="gate-f")f.stored.artifactAcceptance.id+="changed";if(kind==="paper")f.stored.hiddenEvalSuite[0]!.expected.push("other");
      if(kind==="baseline")f.stored.baselineRun.id+="new";if(kind==="route")f.stored.campaign.scoringRouteFingerprint="other";
      if(kind==="source")f.stored.sourceArtifacts[0]!.name="changed.html";if(kind==="output")f.stored.outputArtifacts.push({id:"injected",projectId:f.stored.id,round:0,versionLabel:"V1",name:"unexpected.txt",description:"Synthetic unaccepted output",mimeType:"text/plain",kind:"primary",content:"unaccepted",sourceArtifactIds:["source"],isChampion:false,accepted:false,createdAt:"2026-10-14T12:00:00Z"});
    }return structuredClone(f.stored);};await expect(restoreServerHtmlProtectionAcceptedProject(f.args,f.ports)).rejects.toThrow("context-changed");
  });
  it("refuses physical same-ID blob or metadata drift and never regenerates primary bytes",async()=>{
    const f=fixture(),id=f.current.artifactSnapshots[0]!.frozenArtifact!.blobId;f.metadata.get(id)!.sha256="b".repeat(64);
    await expect(readServerHtmlProtectionAcceptedFile(f.args,f.ports)).rejects.toThrow();
  });
});


/** Controlled registered capabilities test this consumer only; these fixtures do not prove any real HTML scope. */
function wholeFixture(){
  const f=fixture(),clock={now:Date.parse("2026-10-14T12:00:01Z")};vi.spyOn(Date,"now").mockImplementation(()=>clock.now);
  f.project.acceptanceRubric=[AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Controlled whole consumer",requirement:"Preserve all original content and behavior",protectedConstraint:true,hardGate:true,minScore:95,artifactIds:["source"]})];
  f.project.hiddenEvalSuite[0]!.criterionIds=["PROTECT-ALL"];f.project.protectedItems=["all original content and behavior"];
  f.project.attentionRequests=[];f.project.campaign.status="completed";
  const operationKey="workflow-control:"+f.project.id+":accepted-reader";
  f.project.campaign.serverControlOwner={schemaVersion:"server-workflow-control-owner-v1",phase:"bound",controlJobId:"accepted-control",operationKey,runId:"accepted-sdk",sourceUpdatedAt:f.project.updatedAt,inputFingerprint:"a".repeat(64),requestedAt:"2026-10-14T11:00:00Z"};
  const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"accepted-control",missionId:f.project.id,type:"campaign",status:"completed",label:"Controlled accepted owner",idempotencyKey:operationKey,generation:1,outputRef:"accepted-sdk",createdAt:"2026-10-14T11:00:00Z",updatedAt:"2026-10-14T12:00:00Z"});
  const actor={sdkStatus:"completed",route:"selected-direct-route"},source=f.project.sourceArtifacts[0]!,snapshot=f.current.artifactSnapshots[0]!,test=f.project.hiddenEvalSuite[0]!,criterion=f.project.acceptanceRubric[0]!;
  const original={sourceArtifactId:source.id,sha256:f.metadata.get("source")!.sha256,byteLength:f.metadata.get("source")!.sizeBytes};
  const required:HtmlProtectionObligation[]=[{id:"controlled-consumer-obligation",sourceArtifactId:source.id,kind:"core-method",target:"controlled-test",description:"Synthetic whole-consumer timing fixture",evidenceKind:"semantic",support:"supported"}];
  const expiresAt="2026-10-14T12:10:00Z",observedAt="2026-10-14T12:00:00Z";
  const make=(arm:"current"|"candidate")=>{
    const binding:HtmlProtectionProofBinding={missionId:f.project.id,testCaseId:test.id,criterionId:criterion.id,paperSha256:"b".repeat(64),original,
      executed:arm==="current"?original:{sourceArtifactId:source.id,sha256:snapshot.frozenArtifact!.sha256,byteLength:snapshot.frozenArtifact!.size},
      subject:arm==="current"?{kind:"current",versionId:f.project.version}:{kind:"candidate",candidateId:f.current.id}};
    const evidence:HtmlProtectionEvidence={schemaVersion:"html-protection-evidence-v1",id:"controlled-"+arm,binding,kind:"semantic",producer:"semantic-runtime",obligationIds:[required[0]!.id],verificationStatus:"verified",observedAt};
    const proof:HtmlProtectionProof={schemaVersion:"html-protection-proof-v1",binding,requiredObligations:required,evidence:[evidence],receipts:[{obligationId:required[0]!.id,verificationStatus:"verified",evidenceIds:[evidence.id]}],verificationStatus:"verified"};
    const reference:HtmlProtectionAuthorityReference={schemaVersion:"html-protection-authority-reference-v1",blobId:"controlled-reference-"+arm,sha256:"c".repeat(64),byteLength:100,criterionId:criterion.id,executionId:"accepted-sdk",jobId:job.id,generation:1,inputSha256:"d".repeat(64),planSha256:"e".repeat(64),scoringRouteFingerprint:actor.route,policyVersion:HTML_PROTECTION_AUTHORITY_POLICY,observedAt,expiresAt};
    return {...f.project.validationRun.runs[0]!,artifactHash:binding.executed.sha256,htmlProtectionProof:proof,htmlProtectionAuthorityRefs:[reference]};
  };
  f.project.validationRun.baselineRuns=[make("current")];f.project.validationRun.runs=[make("candidate")];
  const fingerprint=evidenceFingerprint(f.project,f.current);f.project.validationRun.evidenceFingerprint=fingerprint;f.project.artifactAcceptance.evidenceFingerprint=fingerprint;
  Object.assign(f.stored,structuredClone(f.project));
  f.ports.owner={readMission:async()=>structuredClone(f.stored),readJob:async()=>structuredClone(job),readRun:async()=>({exists:true,status:actor.sdkStatus}),readRoute:async()=>actor.route};
  f.ports.restore=vi.fn(async args=>{const proof=args.run.htmlProtectionProof!;return createHtmlProtectionAuthority({project:args.project,testCase:args.testCase,proof,expectedBinding:proof.binding,requiredObligations:proof.requiredObligations,trustedEvidence:proof.evidence,canonicalRun:args.run,policyVersion:HTML_PROTECTION_AUTHORITY_POLICY,observedAt,expiresAt,now:clock.now});});
  // Controlled consumer fixture only; production installs selection witnesses solely through full authenticated restoration.
  f.ports.assertRestoredOwner=async({project,reference})=>{await assertServerHtmlProtectionOwner({project,execution:{executionId:reference.executionId,jobId:reference.jobId,generation:reference.generation},active:false,scoringRouteFingerprint:reference.scoringRouteFingerprint},f.ports.owner);
    if(clock.now>=Date.parse(reference.expiresAt))throw Error("html-protection-controlled-expiry-after-await");};
  return {...f,clock,job,actor,expiresAt};
}
afterEach(()=>vi.restoreAllMocks());
describe("accepted consumer final I/O guards (controlled local capability fixtures only)",()=>{
  it("allows an actually completed owner and returns copied exact bytes while the original expiry remains valid",async()=>{
    const f=wholeFixture(),result=await readServerHtmlProtectionAcceptedFile(f.args,f.ports),bytes=result.bytes;
    expect(new TextDecoder().decode(bytes)).toBe(f.current.artifactSnapshots[0]!.content);
    bytes[0]=0;expect(result.bytes[0]).not.toBe(0);expect(Object.isFrozen(result.identity)).toBe(true);
    expect(f.ports.restore).toHaveBeenCalledTimes(2);
  });
  it.each(["sdk-cancelled","job-cancelled","route-changed","owner-key","gate-f","paper","expiry","physical-metadata"] as const)("rejects late %s during final frozen-byte I/O even after both authorities were restored",async kind=>{
    const f=wholeFixture(),get=f.ports.store!.get,blobId=f.current.artifactSnapshots[0]!.frozenArtifact!.blobId;let changed=false;
    f.ports.store={...f.ports.store!,get:async id=>{const blob=await get(id);
      if(id===blobId&&vi.mocked(f.ports.restore!).mock.calls.length===2&&!changed){changed=true;
        if(kind==="sdk-cancelled")f.actor.sdkStatus="cancelled";if(kind==="job-cancelled")f.job.status="cancelled";
        if(kind==="route-changed")f.actor.route="another-direct-route";if(kind==="owner-key")f.job.idempotencyKey+="other";
        if(kind==="gate-f")f.stored.artifactAcceptance.hardGatePass=false;if(kind==="paper")f.stored.hiddenEvalSuite[0]!.input+="new-input";
        if(kind==="expiry")f.clock.now=Date.parse(f.expiresAt);if(kind==="physical-metadata")f.metadata.get(id)!.objectPath+="-changed";
      }return blob;}};
    await expect(readServerHtmlProtectionAcceptedFile(f.args,f.ports)).rejects.toThrow();expect(changed).toBe(true);
  });
});
