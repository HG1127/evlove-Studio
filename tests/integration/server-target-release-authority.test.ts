// @vitest-environment node
import {createHash} from "node:crypto";
import {H3} from "nitro/h3";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {evidenceFingerprint} from "@evolution/core";
import {acceptedLegacyHtmlPaperFixture,acceptedPackageFixture} from "@evolution/testkit";
import type {Candidate} from "@evolution/contracts";
const mocks=vi.hoisted(()=>({get:vi.fn(),grant:vi.fn(),blob:vi.fn(),metadata:vi.fn(),provider:vi.fn()}));
vi.mock("../../apps/backend/src/services/production-runtime",()=>({getServerMissionEnvelope:async()=>({payload:await mocks.get()}),getServerProductionRuntime:()=>({missions:{get:mocks.get}})}));
vi.mock("../../apps/backend/src/services/artifact-runtime",()=>({getServerArtifactStore:()=>({get:mocks.blob,getMetadata:mocks.metadata})}));
vi.mock("../../apps/backend/src/services/security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("../../apps/backend/src/services/release-approval-store",()=>({requireActiveReleaseApprovalGrant:mocks.grant,getActiveReleaseApprovalGrant:mocks.grant}));
vi.mock("../../apps/backend/src/services/http-target-gateway",()=>({releaseHttpTarget:mocks.provider}));
import targetRelease from "../../apps/backend/server/api/evolution/target-release.post";
const app=new H3().post("/target-release",targetRelease);
const request=(projectId:string,candidate:Candidate,extra:Record<string,unknown>={})=>app.fetch(new Request("http://localhost/target-release",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId,connectionId:"stored-http-release",candidate,action:"shadow",...extra})}));
function fixture(){
 const f=acceptedPackageFixture(true),p=f.project,champion=p.searchChampion!;
 Object.assign(p.sourceArtifacts[0]!,{name:"original.md",extension:"md",mimeType:"text/markdown",textContent:"Original Markdown instructions."});
 for(const candidate of [f.current,f.prior]){
  const snapshot=candidate.artifactSnapshots[0]!,content=`Updated Markdown instructions for ${candidate.id}.`;
  const sha=createHash("sha256").update(content).digest("hex"),blob=new Blob([content],{type:"text/markdown"});
  Object.assign(snapshot,{name:`${candidate.id}-evolved.md`,mimeType:blob.type,content,contentHash:sha});
  snapshot.frozenArtifact={...snapshot.frozenArtifact!,name:snapshot.name,mimeType:blob.type,snapshotHash:sha,sha256:sha,blobId:"server-candidate:"+sha,size:blob.size};
  f.blobs.set(snapshot.frozenArtifact.blobId,blob);
 }
 champion.artifactAcceptance!.frozenArtifacts=[f.prior.artifactSnapshots[0]!.frozenArtifact!];
 p.experimentRun.winnerId=f.prior.id;p.validationRun=champion.validation!;p.artifactAcceptance=champion.artifactAcceptance!;
 const binding=evidenceFingerprint(p,f.prior);p.validationRun.evidenceFingerprint=binding;p.artifactAcceptance.evidenceFingerprint=binding;
 p.releaseTarget={provider:"http",mode:"preview-promote",status:"connected",label:"Stored HTTP target",connectionId:"stored-http-release",healthPath:"/"};
 p.gates=[{id:"artifact-ready",status:"approved"},{id:"release-ready",status:"approved"}];
 p.release={...p.release,status:"idle",candidateId:f.prior.id,stableDeploymentId:"stored-stable",deploymentId:undefined};
 const original=p.sourceArtifacts[0]!;const raw=new Blob([original.textContent!],{type:original.mimeType});original.size=raw.size;f.blobs.set(original.id,raw);
 for(const [id,blob] of f.blobs){const content=id===original.id?original.textContent!:p.candidates.flatMap(candidate=>candidate.artifactSnapshots).find(snapshot=>snapshot.frozenArtifact?.blobId===id)?.content;
  if(content!==undefined)f.metadata.set(id,{schemaVersion:"artifact-v1",id,missionId:p.id,bucket:"synthetic-private",objectPath:id,mimeType:blob.type,sizeBytes:blob.size,sha256:createHash("sha256").update(content).digest("hex"),createdAt:"2026-10-08T16:00:00.000Z",updatedAt:"2026-10-08T16:00:00.000Z"});}
 mocks.metadata.mockImplementation(async(id:string)=>f.metadata.get(id));
 mocks.grant.mockResolvedValue({id:"stored-active-grant",missionId:p.id,candidateId:f.prior.id,approvedRole:"approver",approvedAt:"2026-01-01T00:00:00.000Z",expiresAt:"2099-01-01T00:00:00.000Z"});
 mocks.get.mockResolvedValue(p);mocks.blob.mockImplementation(async(id:string)=>f.blobs.get(id));
 return {...f,candidate:f.prior};
}
beforeEach(()=>{vi.resetAllMocks();mocks.grant.mockResolvedValue({id:"stored-active-grant"});mocks.provider.mockResolvedValue({ok:true,effectiveAction:"shadow"});});
describe("target release authority comes only from stored Gate F and target",()=>{
 it.each(["search","static","mixed"] as const)("blocks stored whole HTML %s scope even if client omits snapshots",async mode=>{
  const f=acceptedLegacyHtmlPaperFixture(false,mode);f.project.releaseTarget={provider:"http",mode:"preview-promote",status:"connected",connectionId:"stored-http-release",label:"Stored target",healthPath:"/"};mocks.get.mockResolvedValue(f.project);
  const response=await request(f.project.id,{...f.current,artifactSnapshots:[]});
  expect(response.status).toBe(409);expect(await response.text()).toContain("Stored complete protection authority could not be independently restored");
  for(const call of [mocks.grant,mocks.blob,mocks.provider])expect(call).not.toHaveBeenCalled();
 });
 it.each(["shadow","rollback"] as const)("refuses unknown Mission before %s",async action=>{
  const f=fixture();mocks.get.mockResolvedValue(undefined);
  expect((await request("missing",f.candidate,{action})).status).toBe(409);expect(mocks.provider).not.toHaveBeenCalled();
 });
 it("refuses a stored Candidate without accepted Gate F",async()=>{
  const f=fixture();f.project.artifactAcceptance.status="unverified";
  expect((await request(f.project.id,f.candidate)).status).toBe(409);
  for(const call of [mocks.grant,mocks.blob,mocks.provider])expect(call).not.toHaveBeenCalled();
 });
 it("refuses an unaccepted stored alternate Candidate",async()=>{
  const f=fixture();expect((await request(f.project.id,f.current)).status).toBe(409);expect(mocks.provider).not.toHaveBeenCalled();
 });
 it("ignores client body/frozen bytes and sends only SHA-checked physical Gate F bytes",async()=>{
  const f=fixture(),receipt=f.candidate.artifactSnapshots[0]!.frozenArtifact!,wrong="client replacement bytes";
  const fake={sourceArtifactId:receipt.sourceArtifactId,snapshotHash:receipt.snapshotHash,name:receipt.name,mimeType:receipt.mimeType,sha256:createHash("sha256").update(wrong).digest("hex"),size:Buffer.byteLength(wrong),contentBase64:Buffer.from(wrong).toString("base64")};
  const client={...f.candidate,artifactSnapshots:[{...f.candidate.artifactSnapshots[0]!,content:"client Candidate body"}]};
  const response=await request(f.project.id,client,{frozenArtifacts:[fake]});expect(response.status).toBe(200);
  expect(mocks.grant).toHaveBeenCalledWith({missionId:f.project.id,candidateId:f.candidate.id});expect(mocks.blob).toHaveBeenCalledWith(receipt.blobId);
  const payload=mocks.provider.mock.calls[0]![0];expect(payload.connectionId).toBe("stored-http-release");expect(payload.candidate).toEqual(f.candidate);
  expect(payload.frozenArtifacts[0]).toMatchObject({sha256:receipt.sha256,size:receipt.size});expect(Buffer.from(payload.frozenArtifacts[0].contentBase64,"base64").toString()).toBe(f.candidate.artifactSnapshots[0]!.content);
 });
 it.each(["missing","changed"] as const)("refuses %s physical frozen bytes before provider",async mode=>{
  const f=fixture();mocks.blob.mockResolvedValue(mode==="missing"?undefined:new Blob(["changed physical bytes"],{type:"text/markdown"}));
  expect((await request(f.project.id,f.candidate)).status).toBe(409);expect(mocks.provider).not.toHaveBeenCalled();
 });
 it("refuses another client connection before grant or artifact read",async()=>{
  const f=fixture();expect((await request(f.project.id,f.candidate,{connectionId:"other-target"})).status).toBe(409);
  for(const call of [mocks.grant,mocks.blob,mocks.provider])expect(call).not.toHaveBeenCalled();
 });
 it("refuses a wrong release stage before provider",async()=>{
  const f=fixture();expect((await request(f.project.id,f.candidate,{action:"promote"})).status).toBe(409);expect(mocks.provider).not.toHaveBeenCalled();
 });
 it("requires the durable grant before dispatching independently read accepted bytes",async()=>{
  const f=fixture();mocks.grant.mockRejectedValue(new Error("grant expired"));
  expect((await request(f.project.id,f.candidate)).status).toBe(409);expect(mocks.provider).not.toHaveBeenCalled();
 });
 it("allows a known stored approved non-HTML release using actual Gate F bytes",async()=>{
  const f=fixture();expect((await request(f.project.id,f.candidate)).status).toBe(200);expect(mocks.provider).toHaveBeenCalledOnce();expect(mocks.blob).toHaveBeenCalledWith(f.candidate.artifactSnapshots[0]!.frozenArtifact!.blobId);
 });
});
describe("target release recovery keeps object identity without new acceptance",()=>{
 it("allows stored-target rollback despite blocked gates/acceptance, without grant or new byte reads",async()=>{
  const f=fixture();f.project.release.status="promoted";f.project.gates=f.project.gates.map(g=>({...g,status:"blocked"}));f.project.artifactAcceptance.status="unverified";
  mocks.provider.mockResolvedValue({ok:true,effectiveAction:"rollback"});
  expect((await request(f.project.id,f.candidate,{action:"rollback"})).status).toBe(200);
  expect(mocks.provider).toHaveBeenCalledWith(expect.objectContaining({connectionId:"stored-http-release",candidate:f.candidate,action:"rollback",frozenArtifacts:undefined}),expect.any(Function));
  expect(mocks.grant).not.toHaveBeenCalled();expect(mocks.blob).not.toHaveBeenCalled();
 });
 it.each(["idle","missing-stable","candidate-mismatch","connection-mismatch","missing-subject-no-champion"] as const)("refuses rollback %s before provider",async mode=>{
  const f=fixture();f.project.release.status="promoted";let candidate=f.candidate,connectionId="stored-http-release";
  if(mode==="idle")f.project.release.status="idle";if(mode==="missing-stable")f.project.release.stableDeploymentId=undefined;
  if(mode==="candidate-mismatch")candidate=f.current;if(mode==="connection-mismatch")connectionId="other-target";
  if(mode==="missing-subject-no-champion"){f.project.release.candidateId=undefined;f.project.candidates=[];f.project.searchChampion=undefined;}
  expect((await request(f.project.id,candidate,{action:"rollback",connectionId})).status).toBe(409);expect(mocks.provider).not.toHaveBeenCalled();expect(mocks.grant).not.toHaveBeenCalled();
 });
});

it("keeps rollback bound to the stored deployed Candidate after a different experiment winner",async()=>{
 const f=fixture();f.project.release.status="promoted";f.project.experimentRun.winnerId=f.current.id;f.project.gates=f.project.gates.map(g=>({...g,status:"blocked"}));
 mocks.provider.mockResolvedValue({ok:true,effectiveAction:"rollback"});
 expect((await request(f.project.id,f.candidate,{action:"rollback"})).status).toBe(200);
 expect(mocks.provider).toHaveBeenCalledWith(expect.objectContaining({candidate:f.candidate,connectionId:"stored-http-release",action:"rollback"}),expect.any(Function));
 expect(mocks.grant).not.toHaveBeenCalled();expect(mocks.blob).not.toHaveBeenCalled();
});