import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactWriteGovernanceSchema, CandidateSchema, SourceArtifactSchema, type ArtifactWriteGovernance, type EvolveProject, type SourceArtifact } from "@evolution/contracts";
import { applyServerCodebaseOverlay, materializeServerCandidateArtifacts, serverArtifactSha256 } from "./server-experiment-artifacts";

const {blobs,metadata,put,get}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),metadata:new Map<string,unknown>(),put:vi.fn(),get:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get,put,getMetadata:async(id:string)=>metadata.get(id)})}));
beforeEach(()=>{
  blobs.clear();metadata.clear();get.mockReset().mockImplementation(async(id:string)=>blobs.get(id));
  put.mockReset().mockImplementation(async(id:string,blob:Blob,binding?:{missionId?:string;kind?:string})=>{
    blobs.set(id,blob);const at=new Date().toISOString();
    metadata.set(id,{id,schemaVersion:"artifact-v1",missionId:binding?.missionId,kind:binding?.kind,bucket:"test",objectPath:id,
      mimeType:blob.type,sizeBytes:blob.size,sha256:await serverArtifactSha256(await blob.arrayBuffer()),createdAt:at,updatedAt:at});
  });
});
async function zipParent(){
  const zip=new JSZip();zip.file("src/main.ts","export const value = 1;");zip.file("SKILL.md","Immutable skill");
  zip.file("tests/cases.json",'["fixed test"]');zip.file("assets/icon.bin",new Uint8Array([0,255,7,9]));
  return new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:"application/zip"});
}
async function policy(parent:Blob, overrides:Record<string,unknown>={}){
  return ArtifactWriteGovernanceSchema.parse({version:"artifact-write-governance-v1",parentSha256:await serverArtifactSha256(await parent.arrayBuffer()),
    policy:{allowedPaths:["src/main.ts","src/new.ts"],protectedPaths:["SKILL.md","tests","assets"],...overrides}});
}
const overlay=(files:Array<{path:string;content:string}>,deletions:string[]=[])=>JSON.stringify({kind:"codebase",overlay:true,files,deletions});
function mission(sources:SourceArtifact[]):EvolveProject{
  return {id:"write-test-mission",name:"Write test",version:"V1",sourceArtifacts:sources,protectedItems:[],editableItems:[]} as unknown as EvolveProject;
}
const candidate=()=>CandidateSchema.parse({id:"candidate-write-test",name:"Candidate",change:"Measured change"});
function source(name:string,id:string,governance?:ArtifactWriteGovernance){
  const zip=name.endsWith(".zip");
  return SourceArtifactSchema.parse({id,name,extension:zip?"zip":"txt",role:"target",artifactKind:zip?"codebase":"generic",mimeType:zip?"application/zip":"text/plain",
    inputMode:"upload",size:blobs.get(id)?.size??0,storageRef:id,createdAt:"2026-11-11T08:00:00.000Z",mutationGovernance:governance});
}

describe("actual materializer write governance",()=>{
  it("applies an approved ZIP update and keeps protected binary and text bytes",async()=>{
    const parent=await zipParent(),governance=await policy(parent);
    const result=await applyServerCodebaseOverlay(parent,overlay([{path:"src/main.ts",content:"export const value = 2;"}]),"application/zip",governance);
    const zip=await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(await zip.file("src/main.ts")!.async("string")).toBe("export const value = 2;");
    expect(await zip.file("SKILL.md")!.async("string")).toBe("Immutable skill");
    expect(await zip.file("assets/icon.bin")!.async("uint8array")).toEqual(new Uint8Array([0,255,7,9]));
    expect(await zip.file("tests/cases.json")!.async("string")).toBe('["fixed test"]');
  });
  it.each(["SKILL.md","tests/cases.json","assets/icon.bin"])("rejects protected file %s",async(path)=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path,content:"changed"}]),"application/zip",await policy(parent))).rejects.toThrow("protected-path");
  });
  it("does not let the model grant itself permission",async()=>{
    const parent=await zipParent();
    const payload=JSON.stringify({kind:"codebase",overlay:true,files:[{path:"unauthorized.ts",content:"x"}],deletions:[],mutationGovernance:{policy:{allowedPaths:["unauthorized.ts"]}}});
    await expect(applyServerCodebaseOverlay(parent,payload,"application/zip",await policy(parent))).rejects.toThrow("not-allowlisted");
  });
  it("rejects a stale approved ZIP parent",async()=>{
    const parent=await zipParent(),governance=await policy(parent);
    governance.parentSha256="0".repeat(64);
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"src/main.ts",content:"v2"}]),"application/zip",governance)).rejects.toThrow("STALE_PARENT");
  });
  it("rejects deletion by default and permits only explicitly allowed deletion",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([],["src/main.ts"]),"application/zip",await policy(parent))).rejects.toThrow("delete-forbidden");
    const result=await applyServerCodebaseOverlay(parent,overlay([],["src/main.ts"]),"application/zip",await policy(parent,{allowDelete:true}));
    const zip=await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(zip.file("src/main.ts")).toBeNull();expect(zip.file("SKILL.md")).not.toBeNull();
  });
  it("rejects an unchanged update even if the model claims a new output hash",async()=>{
    const parent=await zipParent();
    const payload=JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/main.ts",content:"export const value = 1;",contentSha256:"f".repeat(64)}]});
    await expect(applyServerCodebaseOverlay(parent,payload,"application/zip",await policy(parent))).rejects.toThrow("noop");
  });
  it("rejects directory deletions, path traversal and case aliases",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([],["src"]),"application/zip",await policy(parent,{allowedPaths:["src"],allowDelete:true}))).rejects.toThrow();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"../escape.ts",content:"x"}]),"application/zip",await policy(parent))).rejects.toThrow();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"SRC/MAIN.TS",content:"x"}]),"application/zip",await policy(parent,{allowedPaths:["SRC/MAIN.TS"]}))).rejects.toThrow("case alias");
  });
  it("enforces size and changed-file budgets",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"src/main.ts",content:"汉".repeat(5)}]),"application/zip",await policy(parent,{maxFileBytes:10}))).rejects.toThrow("content-too-large");
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"src/main.ts",content:"v2"},{path:"src/new.ts",content:"v3"}]),"application/zip",await policy(parent,{maxChangedFiles:1}))).rejects.toThrow("too-many-files");
  });
  it("rejects null governance rather than treating it as legacy",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"src/main.ts",content:"v2"}]),"application/zip",null as unknown as ArtifactWriteGovernance)).rejects.toThrow();
  });
  it("enforces text-file scope at the actual persistence boundary",async()=>{
    const parent=new Blob(["old"],{type:"text/plain"});blobs.set("text",parent);
    const governance=await policy(parent,{allowedPaths:["notes.txt"],protectedPaths:[]});
    const result=await materializeServerCandidateArtifacts(mission([source("notes.txt","text",governance)]),candidate(),[{sourceArtifactId:"text",name:"notes.txt",mimeType:"text/plain",content:"new"}],"test");
    const frozen=result.artifactSnapshots[0].frozenArtifact!;
    expect(await blobs.get(frozen.blobId)!.text()).toBe("new");expect(put).toHaveBeenCalledTimes(2); // frozen output + trusted lineage receipt
  });
  it("rejects target renames before storing bytes",async()=>{
    const parent=new Blob(["old"]);blobs.set("text",parent);
    const governance=await policy(parent,{allowedPaths:["notes.txt"],protectedPaths:[]});
    await expect(materializeServerCandidateArtifacts(mission([source("notes.txt","text",governance)]),candidate(),[{sourceArtifactId:"text",name:"other.txt",mimeType:"text/plain",content:"new"}],"test")).rejects.toThrow("rename");
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects the whole candidate when a later target is unauthorized: no earlier partial write",async()=>{
    const text=new Blob(["old"],{type:"text/plain"}),zip=await zipParent();blobs.set("text",text);blobs.set("zip",zip);
    const sources=[source("notes.txt","text",await policy(text,{allowedPaths:["notes.txt"],protectedPaths:[]})),source("repo.zip","zip",await policy(zip))];
    await expect(materializeServerCandidateArtifacts(mission(sources),candidate(),[
      {sourceArtifactId:"text",name:"notes.txt",mimeType:"text/plain",content:"valid update"},
      {sourceArtifactId:"zip",name:"repo.zip",mimeType:"application/zip",content:overlay([{path:"SKILL.md",content:"unauthorized"}])},
    ],"test")).rejects.toThrow("protected-path");
    expect(put).not.toHaveBeenCalled();expect(await blobs.get("text")!.text()).toBe("old");
  });
  it("also validates the parent hash of a keep-parent ZIP",async()=>{
    const parent=await zipParent();blobs.set("zip",parent);const governance=await policy(parent);governance.parentSha256="0".repeat(64);
    await expect(materializeServerCandidateArtifacts(mission([source("repo.zip","zip",governance)]),candidate(),[{sourceArtifactId:"zip",name:"repo.zip",mimeType:"application/zip",content:JSON.stringify({kind:"keep-parent",sourceArtifactId:"zip"})}],"test")).rejects.toThrow("STALE_PARENT");
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects aliases of an existing directory when adding a new file",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"SRC/new.ts",content:"x"}]),"application/zip",await policy(parent,{allowedPaths:["SRC/new.ts"]}))).rejects.toThrow("case alias");
  });
  it("rejects replacing a directory with a file",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"src",content:"x"}]),"application/zip",await policy(parent,{allowedPaths:["src"]}))).rejects.toThrow("directory");
  });
  it("permits an approved new file while preserving all prior entries",async()=>{
    const parent=await zipParent();
    const result=await applyServerCodebaseOverlay(parent,overlay([{path:"src/new.ts",content:"new module"}]),"application/zip",await policy(parent));
    const zip=await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(await zip.file("src/new.ts")!.async("string")).toBe("new module");
    expect(await zip.file("src/main.ts")!.async("string")).toBe("export const value = 1;");
  });
  it.each([
    {name:"report.docx",extension:"docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",artifactKind:"document"},
    {name:"deck.pptx",extension:"pptx",mimeType:"application/vnd.openxmlformats-officedocument.presentationml.presentation",artifactKind:"presentation"},
    {name:"model.xlsx",extension:"xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",artifactKind:"spreadsheet"},
  ])("fails closed on governed native Office target $extension until a native write guard is supplied",async format=>{
    const parent=new Blob(["native stub"]),governance=await policy(parent,{allowedPaths:[format.name],protectedPaths:[]});
    const native=SourceArtifactSchema.parse({...source("notes.txt","native"),name:format.name,extension:format.extension,artifactKind:format.artifactKind,mutationGovernance:governance});
    await expect(materializeServerCandidateArtifacts(mission([native]),candidate(),[{sourceArtifactId:"native",name:format.name,mimeType:format.mimeType,content:"{}"}],"test")).rejects.toThrow("FORMAT_UNSUPPORTED");
    expect(put).not.toHaveBeenCalled();
  });  it("rejects a stale text policy before persistence",async()=>{
    const parent=new Blob(["old"]);blobs.set("text",parent);const governance=await policy(parent,{allowedPaths:["notes.txt"],protectedPaths:[]});governance.parentSha256="0".repeat(64);
    await expect(materializeServerCandidateArtifacts(mission([source("notes.txt","text",governance)]),candidate(),[{sourceArtifactId:"text",name:"notes.txt",mimeType:"text/plain",content:"new"}],"test")).rejects.toThrow("STALE_PARENT");
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects a file/descendant conflict inside the same new overlay",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"fresh",content:"file"},{path:"fresh/a.ts",content:"child"}]),"application/zip",await policy(parent,{allowedPaths:["fresh","fresh/a.ts"]}))).rejects.toThrow("collision");
  });
  it("rejects case aliases between new directories in one overlay",async()=>{
    const parent=await zipParent();
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"New/a.ts",content:"a"},{path:"new/b.ts",content:"b"}]),"application/zip",await policy(parent,{allowedPaths:["New/a.ts","new/b.ts"]}))).rejects.toThrow("case alias");
  });
  it("refuses symlink-bearing parents under the governed ZIP contract",async()=>{
    const zip=new JSZip();zip.file("link","SKILL.md",{unixPermissions:0o120777});
    const parent=new Blob([await zip.generateAsync({type:"arraybuffer",platform:"UNIX"})]);
    await expect(applyServerCodebaseOverlay(parent,overlay([{path:"src/new.ts",content:"x"}]),"application/zip",await policy(parent))).rejects.toThrow("unsafe parent");
  });
  it("routes stored ZIP source policy through the actual materializer before persistence",async()=>{
    const parent=await zipParent();blobs.set("zip",parent);
    const result=await materializeServerCandidateArtifacts(mission([source("repo.zip","zip",await policy(parent))]),candidate(),[{sourceArtifactId:"zip",name:"repo.zip",mimeType:"application/zip",content:overlay([{path:"src/main.ts",content:"export const value = 2;"}])}],"test");
    expect(put).toHaveBeenCalledTimes(2); // frozen ZIP + immutable write-lineage receipt
    const zip=await JSZip.loadAsync(await blobs.get(result.artifactSnapshots[0].frozenArtifact!.blobId)!.arrayBuffer());
    expect(await zip.file("src/main.ts")!.async("string")).toBe("export const value = 2;");
  });
  it("preserves legacy schemas but never claims new policy enforcement for them",()=>{
    expect(source("notes.txt","text").mutationGovernance).toBeUndefined();
    expect(SourceArtifactSchema.safeParse({...source("notes.txt","text"),mutationGovernance:null}).success).toBe(false);
  });
});
