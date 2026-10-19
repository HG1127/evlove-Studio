import {afterEach,describe,expect,it,vi} from "vitest";
import {OutputArtifactSchema,type ProductionRuntimePorts} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {configureProductionRuntime,resetProductionRuntime} from "./production-runtime";
import {readAcceptedPrimary,buildDeliverableZip} from "./artifact-output-builders";
// The HTTP adapter returns bytes in the configured runtime realm. Node TextEncoder
// in jsdom has a separate Uint8Array realm; reproduce the adapter's explicit copy.
function fixture(){const f=acceptedPackageFixture(false),receipt=f.current.artifactSnapshots[0]!.frozenArtifact!,artifact={candidateId:f.current.id,sourceArtifactIds:[receipt.sourceArtifactId],frozenArtifact:receipt,content:f.current.artifactSnapshots[0]!.content},bytes=new Uint8Array(new TextEncoder().encode(artifact.content));
  const identity={missionId:f.project.id,candidateId:f.current.id,sourceArtifactId:receipt.sourceArtifactId,acceptanceId:f.project.artifactAcceptance.id,validationId:f.project.validationRun.id,blobId:receipt.blobId,sha256:receipt.sha256,size:receipt.size,name:receipt.name,mimeType:receipt.mimeType};
  const ports={missions:{},jobs:{},events:{},artifacts:f.store,acceptedDownloads:{file:vi.fn(async()=>({bytes,identity})),package:vi.fn()}} as unknown as ProductionRuntimePorts;
  return {...f,artifact,bytes,identity,ports};}
function blobText(blob:Blob){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result));reader.readAsText(blob);});}
afterEach(()=>{resetProductionRuntime();vi.unstubAllGlobals();});
describe("configured accepted download UI port (synthetic, no Core authority DTO)",()=>{
  it("uses an injected governed HTTP port without a relative or alternate fetch",async()=>{
    const f=fixture();configureProductionRuntime(f.ports,"http");const fetch=vi.fn(async()=>{throw Error("UI raw fetch is forbidden");});vi.stubGlobal("fetch",fetch);
    expect(await blobText((await readAcceptedPrimary(f.project,f.artifact)).blob)).toBe(f.artifact.content);expect(f.ports.acceptedDownloads!.file).toHaveBeenCalledTimes(1);expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["acceptanceId","validationId","name","mimeType","blobId","sourceArtifactId"] as const)("rejects complete same-SHA %s drift",async key=>{
    const f=fixture();f.identity[key]+="changed";configureProductionRuntime(f.ports,"http");await expect(readAcceptedPrimary(f.project,f.artifact)).rejects.toThrow("验收身份已变化");
  });
  it("refuses a non-byte port value even with matching receipt identity",async()=>{const f=fixture();f.ports.acceptedDownloads!.file=vi.fn(async()=>({identity:f.identity,bytes:Array.from(f.bytes) as unknown as Uint8Array}));configureProductionRuntime(f.ports,"http");await expect(readAcceptedPrimary(f.project,f.artifact)).rejects.toThrow("下载端口没有返回实际字节");});
  it("refuses altered actual bytes even with unchanged receipt identity",async()=>{const f=fixture();f.bytes[0]^=1;configureProductionRuntime(f.ports,"http");await expect(readAcceptedPrimary(f.project,f.artifact)).rejects.toThrow("下载字节与冻结文件不一致");});
  it("refuses a configured HTTP runtime without the operation instead of falling back to current origin",async()=>{
    const f=fixture();f.ports.acceptedDownloads=undefined;configureProductionRuntime(f.ports,"http");const fetch=vi.fn();vi.stubGlobal("fetch",fetch);await expect(readAcceptedPrimary(f.project,f.artifact)).rejects.toThrow("生产端口不支持");expect(fetch).not.toHaveBeenCalled();
  });
});

// The returned receipt supplies the actual operation filename; display wrappers cannot select it.
it("returns the fully verified official filename alongside immutable bytes",async()=>{const f=fixture();configureProductionRuntime(f.ports,"http");const result=await readAcceptedPrimary(f.project,f.artifact);expect(result.identity.name).toBe(f.identity.name);expect(Object.isFrozen(result.identity)).toBe(true);});

function zipFixture(){const f=fixture(),source=f.project.sourceArtifacts[0]!,receipt=f.artifact.frozenArtifact,secondReceipt={...receipt,sourceArtifactId:"second-target",name:"second-evolved.html",blobId:"second-frozen"};
  f.project.sourceArtifacts.push({...source,id:secondReceipt.sourceArtifactId,name:"second-original.html"});
  const first=OutputArtifactSchema.parse({id:"primary-one",projectId:f.project.id,candidateId:f.current.id,round:0,versionLabel:"Accepted",name:receipt.name,mimeType:receipt.mimeType,kind:"primary",content:f.artifact.content,description:"Synthetic first Target",sourceArtifactIds:[receipt.sourceArtifactId],frozenArtifact:receipt,accepted:true,createdAt:source.createdAt});
  const second=OutputArtifactSchema.parse({...first,id:"primary-two",name:secondReceipt.name,sourceArtifactIds:[secondReceipt.sourceArtifactId],frozenArtifact:secondReceipt});
  const metadata=OutputArtifactSchema.parse({...first,id:"metadata",kind:"manifest",name:"manifest.json",mimeType:"application/json",content:"{}",sourceArtifactIds:[],frozenArtifact:undefined});
  f.project.outputArtifacts=[first,second,metadata];const packageIdentity={missionId:f.project.id,candidateId:f.current.id,acceptanceId:f.project.artifactAcceptance.id,validationId:f.project.validationRun.id};
  const packageData={schemaVersion:"accepted-package-download-v2" as const,...packageIdentity,targetSourceArtifactIds:[source.id,secondReceipt.sourceArtifactId],artifacts:[first,second,metadata].map(artifact=>({...artifact,packageIdentity:{...packageIdentity}}))};
  f.ports.acceptedDownloads!.package=vi.fn(async()=>structuredClone(packageData));f.ports.acceptedDownloads!.file=vi.fn(async input=>({bytes:new Uint8Array(f.bytes),identity:input.sourceArtifactId===source.id?{...f.identity}:{...f.identity,sourceArtifactId:secondReceipt.sourceArtifactId,name:secondReceipt.name,blobId:secondReceipt.blobId}}));
  return {...f,packageData};}
describe("complete current ZIP facts (synthetic ports, never Core authority)",()=>{
  it("accepts both unique current Target files and consistently bound metadata",async()=>{const f=zipFixture();configureProductionRuntime(f.ports,"http");await expect(buildDeliverableZip(f.project)).resolves.toBeInstanceOf(Blob);expect(f.ports.acceptedDownloads!.file).toHaveBeenCalledTimes(2);});
  it.each(["missing-target","self-declared-subset","foreign-candidate-metadata","foreign-mission-metadata","foreign-acceptance-metadata","duplicate-primary","foreign-source-metadata"] as const)("rejects %s before reading any file even when every file port can return exact bytes/current IDs",async kind=>{
    const f=zipFixture(),data=f.packageData;if(kind==="missing-target"||kind==="self-declared-subset")data.artifacts.splice(1,1);
    if(kind==="self-declared-subset")data.targetSourceArtifactIds.splice(1,1);
    const metadata=data.artifacts.find(item=>item.kind==="manifest")!;
    if(kind==="foreign-candidate-metadata")metadata.candidateId="foreign";if(kind==="foreign-mission-metadata")metadata.projectId="foreign";
    if(kind==="foreign-acceptance-metadata")metadata.packageIdentity.acceptanceId="old-acceptance";
    if(kind==="duplicate-primary")data.artifacts.push({...data.artifacts[0]!,id:"duplicate-primary"});if(kind==="foreign-source-metadata")metadata.sourceArtifactIds=["foreign-source"];
    configureProductionRuntime(f.ports,"http");await expect(buildDeliverableZip(f.project)).rejects.toThrow();expect(f.ports.acceptedDownloads!.file).not.toHaveBeenCalled();
  });
});
