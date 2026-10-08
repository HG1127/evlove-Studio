// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, SourceArtifactSchema, type EvolveProject } from "@evolution/contracts";
import { buildServerExperimentCandidate, materializeServerCandidateArtifacts, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";

const { blobs, ai, put }=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn(),put:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put})}));
vi.mock("./ai-gateway",()=>({runServerAi:ai}));
const before="主管确认退款后才进入执行。";
const after="主管确认退款后才进入执行，并记录审批编号。";
const original="<html><body>"+before+"</body></html>";
const protectedText="不可改动的保护条款。\n";
const edit=(from=before,to=after)=>JSON.stringify({kind:"text-edits",edits:[{before:from,after:to}]});
function fixture(){
  const make=(id:string,name:string,mimeType:string,content:string)=>SourceArtifactSchema.parse({id,name,mimeType,extension:name.split(".").pop(),artifactKind:"document",role:"target",size:Buffer.byteLength(content),inputMode:"upload",parseStatus:"ready",textContent:content,createdAt:"2026-10-08T00:00:00.000Z"});
  const source=make("source","original.html","text/html",original);
  const protectedSource=make("protected","protected.md","text/markdown",protectedText);
  blobs.set(source.id,new Blob([original],{type:source.mimeType}));
  blobs.set(protectedSource.id,new Blob([protectedText],{type:protectedSource.mimeType}));
  const candidate=CandidateSchema.parse({id:"child",name:"补齐审批",change:"只修改退款审批",patches:[{id:"patch",component:"code",operation:"update",target:before,artifactId:source.id,content:after,rationale:"补齐审批编号"}]});
  const project={id:"multi-text-mission",name:"多文件真实成果",version:"V1",sourceArtifacts:[source,protectedSource],goal:"细化审批并保留保护条款",evolutionCommand:"只修改审批",protectedItems:[],editableItems:[],acceptanceRubric:[]} as unknown as EvolveProject;
  const artifacts=[{sourceArtifactId:source.id,name:"evolved.html",mimeType:source.mimeType,content:edit()},{sourceArtifactId:protectedSource.id,name:protectedSource.name,mimeType:protectedSource.mimeType,content:protectedText}];
  return {project,candidate,source,protectedSource,artifacts};
}
beforeEach(()=>{blobs.clear();ai.mockReset();put.mockReset();put.mockImplementation(async(id:string,blob:Blob)=>{blobs.set(id,blob);});});

describe("server Candidate changes across multiple text Targets",()=>{
  it("freezes a scoped exact edit and preserves another Target without redundant AI",async()=>{
    const args=fixture();ai.mockRejectedValue(new Error("model unavailable"));
    const result=await buildServerExperimentCandidate(args.project,args.candidate);
    expect(ai).not.toHaveBeenCalled();
    expect(result.artifactSnapshots.map(x=>x.content)).toEqual([original.replace(before,after),protectedText]);
    expect(result.artifactSnapshots[1]!.name).toBe(args.protectedSource.name);
    for(const snapshot of result.artifactSnapshots){
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
      expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(snapshot.content);
    }
  });

  it("accepts model output which changes one Target and retains another",async()=>{
    const args=fixture();args.candidate.patches[0]!.target="退款审批说明段落";
    ai.mockResolvedValue({summary:"局部变异",artifacts:args.artifacts});
    const result=await buildServerExperimentCandidate(args.project,args.candidate);
    expect(ai).toHaveBeenCalledOnce();expect(result.artifactSnapshots).toHaveLength(2);
    expect(result.artifactSnapshots[0]!.content).toBe(original.replace(before,after));
    expect(result.artifactSnapshots[1]!.content).toBe(protectedText);
    expect(await verifyServerCandidateFrozenArtifact(result.artifactSnapshots[1]!)).toBe(true);
  });

  it("retains a large untouched upload through an exact no-op excerpt edit",async()=>{
    const args=fixture();args.candidate.patches[0]!.target="退款审批说明段落";
    const untouched="protected document\n".repeat(3000)+protectedText;
    args.protectedSource.size=Buffer.byteLength(untouched);args.protectedSource.textContent="STALE PARSED INDEX";
    blobs.set(args.protectedSource.id,new Blob([untouched],{type:args.protectedSource.mimeType}));
    args.artifacts[1]!.content=edit(protectedText,protectedText);
    ai.mockResolvedValue({summary:"局部变异",artifacts:args.artifacts});
    const result=await buildServerExperimentCandidate(args.project,args.candidate);
    const snapshot=result.artifactSnapshots[1]!;
    expect(snapshot.content).toBe(untouched);
    expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(untouched);
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    expect(ai).toHaveBeenCalledOnce();
  });

  it.each([false,true])("retains an untouched accepted Champion's exact receipt (tampered=%s)",async(tampered)=>{
    const args=fixture();
    const parent=await materializeServerCandidateArtifacts(args.project,args.candidate,args.artifacts,"previous accepted change");
    args.project.searchChampion={candidate:parent,validation:{status:"completed",recommendation:"release"},artifactAcceptance:{status:"passed",candidateId:parent.id}} as EvolveProject["searchChampion"];
    args.candidate.patches[0]!.target=after;
    args.candidate.patches[0]!.content=after+"审批失败时必须回退。";
    put.mockClear();ai.mockRejectedValue(new Error("model unavailable"));
    const retained=parent.artifactSnapshots[1]!;
    if(tampered){
      blobs.set(retained.frozenArtifact!.blobId,new Blob(["tampered"]));
      await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("冻结文件");
      expect(put).not.toHaveBeenCalled();
    }else{
      const result=await buildServerExperimentCandidate(args.project,args.candidate);
      expect(result.artifactSnapshots[1]!.frozenArtifact).toEqual(retained.frozenArtifact);
      expect(result.artifactSnapshots[1]!.content).toBe(protectedText);
      expect(result.artifactSnapshots[0]!.content).toContain(args.candidate.patches[0]!.content);
      expect(put).toHaveBeenCalledOnce();
      expect(await verifyServerCandidateFrozenArtifact(result.artifactSnapshots[1]!)).toBe(true);
    }
    expect(ai).not.toHaveBeenCalled();
  });

  it("checks a later file's format before freezing an earlier valid Target",async()=>{
    const args=fixture();args.protectedSource.extension="json";args.protectedSource.name="protected.json";
    args.artifacts[1]!.content="invalid changed JSON";
    await expect(materializeServerCandidateArtifacts(args.project,args.candidate,args.artifacts,"bad later format")).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses an entirely unchanged set before any Artifact write",async()=>{
    const args=fixture();args.artifacts[0]!.content=original;
    args.source.textContent="STALE PARSED INDEX";
    await expect(materializeServerCandidateArtifacts(args.project,args.candidate,args.artifacts,"no change")).rejects.toThrow("完全相同");
    expect(put).not.toHaveBeenCalled();
  });

  it("does not freeze earlier Targets when a later text edit is invalid",async()=>{
    const args=fixture();args.artifacts[1]!.content=edit("不存在的保护条款","new content");
    await expect(materializeServerCandidateArtifacts(args.project,args.candidate,args.artifacts,"invalid later edit")).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses a missing unchanged upload instead of trusting its parsed text",async()=>{
    const args=fixture();blobs.delete(args.protectedSource.id);
    await expect(materializeServerCandidateArtifacts(args.project,args.candidate,args.artifacts,"missing bytes")).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
