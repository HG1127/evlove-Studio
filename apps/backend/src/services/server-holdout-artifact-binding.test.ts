// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, SourceArtifactSchema, type Candidate, type EvolveProject } from "@evolution/contracts";
import { readServerHoldoutArtifactFingerprint } from "./server-holdout-artifact-binding";

const { blobs } = vi.hoisted(()=>({ blobs:new Map<string,Blob>() }));
vi.mock("./artifact-runtime",()=>({ getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id)}) }));
const original="<html><body>Original source</body></html>";
const changed="<html><body>Changed content</body></html>";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const source=SourceArtifactSchema.parse({id:"source",name:"source.html",mimeType:"text/html",extension:"html",role:"target",artifactKind:"document",inputMode:"upload",storageRef:"original",size:Buffer.byteLength(original),parseStatus:"ready",textContent:"STALE INDEX",createdAt:"2026-10-08T00:00:00.000Z"});
function candidate(content=changed,id="C1",blobId="frozen"):Candidate {
  return CandidateSchema.parse({id,name:id,change:"improve",artifactBuildStatus:"ready",artifactSnapshots:[{
    id:"snapshot-"+id,sourceArtifactId:source.id,name:"changed.html",mimeType:"text/html",content,contentHash:sha(content),
    frozenArtifact:{sourceArtifactId:source.id,snapshotHash:sha(content),blobId,name:"changed.html",mimeType:"text/html",
      sha256:sha(content),size:Buffer.byteLength(content),verifiedAt:"2026-10-08T00:00:00.000Z",checks:[],limitations:[]},
    createdAt:"2026-10-08T00:00:00.000Z",
  }]});
}
function project():EvolveProject {
  return {id:"mission",targetConnection:{adapter:"artifact"},sourceArtifacts:[source]} as EvolveProject;
}
beforeEach(()=>{blobs.clear();blobs.set("original",new Blob([original],{type:"text/html"}));blobs.set("frozen",new Blob([changed],{type:"text/html"}));});
describe("server Hidden physical recovery binding",()=>{
  it("verifies supplied physical observations instead of falling back to another store",async()=>{
    const get=vi.fn(async(id:string)=>id==="original"?blobs.get(id):new Blob([changed.replace("Changed","CHANGED")],{type:"text/html"}));
    await expect(readServerHoldoutArtifactFingerprint({project:project(),candidate:candidate()},{get})).rejects.toThrow("冻结身份");
    expect(get).toHaveBeenCalledTimes(2);expect(await blobs.get("frozen")!.text()).toBe(changed);
  });
  it("binds actual source and frozen Candidate without changing either file",async()=>{
    const args={project:project(),candidate:candidate()};
    const first=await readServerHoldoutArtifactFingerprint(args);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await readServerHoldoutArtifactFingerprint(args)).toBe(first);
    expect(await blobs.get("original")!.text()).toBe(original);expect(await blobs.get("frozen")!.text()).toBe(changed);
    args.project.sourceArtifacts=[{...source,textContent:"ANOTHER PARSED INDEX"}];
    expect(await readServerHoldoutArtifactFingerprint(args)).toBe(first);
  });
  it("changes on same-size actual source bytes despite an unchanged parsed index",async()=>{
    const args={project:project(),candidate:candidate()};const first=await readServerHoldoutArtifactFingerprint(args);
    blobs.set("original",new Blob([original.replace("Original","ORIGINAL")],{type:"text/html"}));
    expect(await readServerHoldoutArtifactFingerprint(args)).not.toBe(first);
  });
  it("binds the accepted Champion as current and refuses its missing bytes",async()=>{
    const parent=candidate(original,"parent","parent-blob");blobs.set("parent-blob",new Blob([original],{type:"text/html"}));
    const p=project();p.searchChampion={candidate:parent,validation:{status:"completed",recommendation:"release"},
      artifactAcceptance:{status:"passed",candidateId:parent.id}} as EvolveProject["searchChampion"];
    expect(await readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()})).toMatch(/^[0-9a-f]{64}$/);
    blobs.delete("parent-blob");
    await expect(readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()})).rejects.toThrow("冻结身份");
  });
  it("never falls back to the original when Champion trust is missing",async()=>{
    const p=project();p.searchChampion={candidate:candidate()} as EvolveProject["searchChampion"];
    expect(await readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()})).toBeUndefined();
  });
  it.each(["missing","changed","snapshot"] as const)("refuses %s frozen Candidate evidence",async(kind)=>{
    const c=candidate();
    if(kind==="missing")blobs.delete("frozen");
    if(kind==="changed")blobs.set("frozen",new Blob([changed.replace("Changed","CHANGED")],{type:"text/html"}));
    if(kind==="snapshot")c.artifactSnapshots[0]!.content+="altered";
    await expect(readServerHoldoutArtifactFingerprint({project:project(),candidate:c})).rejects.toThrow("冻结身份");
  });
  it("binds references and complete pasted sources",async()=>{
    const p=project();p.sourceArtifacts.push({...source,id:"reference",role:"reference",inputMode:"paste",storageRef:undefined,textContent:"reference A"});
    const first=await readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()});
    p.sourceArtifacts[1]!.textContent="reference B";
    expect(await readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()})).not.toBe(first);
    p.sourceArtifacts[1]!.textContent=undefined;
    expect(await readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()})).toBeUndefined();
  });
  it.each(["http","connector","git"] as const)("does not reuse the live %s target as a file observation",async(adapter)=>{
    const p=project();p.targetConnection.adapter=adapter;
    expect(await readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()})).toBeUndefined();
  });
  it("refuses missing sources and ambiguous Target snapshots",async()=>{
    const p=project();blobs.delete("original");
    expect(await readServerHoldoutArtifactFingerprint({project:p,candidate:candidate()})).toBeUndefined();
    const c=candidate();c.artifactSnapshots.push(c.artifactSnapshots[0]!);
    expect(await readServerHoldoutArtifactFingerprint({project:p,candidate:c})).toBeUndefined();
  });
});
