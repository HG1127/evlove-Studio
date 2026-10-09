// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {buildServerExperimentCandidate,materializeServerCandidateArtifacts,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
const {blobs,ai,put}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn(),put:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put})}));
vi.mock("./ai-gateway",()=>({runServerAi:ai}));
import {buildServerCandidateTargetContext} from "./server-candidate-context";
const before='<p id="approval">主管确认退款后才执行。</p>';
const after='<p id="approval">主管确认退款后才执行，并记录审批编号。</p>';
const protectedSection='<article class="slide-card" id="slide-51"><h2>原标题</h2><p>原有步骤</p></article>';
const original='<html><body>'+protectedSection+'<p>未修改的文字与 Unicode 字节。</p>'.repeat(2500)+before+'</body></html>';
const edit=(from=before,to=after)=>JSON.stringify({kind:"text-edits",edits:[{before:from,after:to}]});
const output=(content=edit())=>({summary:"执行局部修改",artifacts:[{sourceArtifactId:"source",name:"evolved.html",mimeType:"text/html",content,notes:[]}]});
function fixture(){
 const source=SourceArtifactSchema.parse({id:"source",name:"large.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",inputMode:"upload",size:Buffer.byteLength(original),textContent:"STALE INDEX",createdAt:"2026-10-09T00:00:00Z"});
 const candidate=CandidateSchema.parse({id:"child",name:"补齐审批",change:"记录编号",designRationale:{sourceEvidence:[before]}});
 const project={id:"mission",name:"完整文件",version:"V1",sourceArtifacts:[source],protectedItems:["保留 slide-51 原有标题、内容与结构"],editableItems:[],acceptanceRubric:[],goal:"保留全文并细化退款审批",evolutionCommand:"增加审批编号"} as unknown as EvolveProject;
 blobs.set(source.id,new Blob([original],{type:source.mimeType}));return {project,candidate,source};
}
beforeEach(()=>{blobs.clear();ai.mockReset();put.mockReset();put.mockImplementation(async(id:string,blob:Blob)=>{blobs.set(id,blob);});});
describe("bounded server Candidate construction recovery",()=>{
 it.each(["anchor","ambiguous","overlap","excerpt-rewrite","noop","protected-title","duplicate-id","text-format"])("repairs %s once before freezing any bytes",async kind=>{
  const args=fixture();
  const bad=kind==="anchor"?edit("invented anchor"):kind==="ambiguous"?edit("<p>","<p>changed"):kind==="overlap"?JSON.stringify({kind:"text-edits",edits:[{before,after},{before,after}]}):kind==="excerpt-rewrite"?"<html><body>partial rewrite</body></html>":kind==="noop"?edit(before,before):kind==="protected-title"?edit("原标题","新标题"):kind==="duplicate-id"?edit(before,before+'<p id="approval">duplicate</p>'):JSON.stringify({kind:"text-edits",edits:[]});
  const first=output(bad);
  ai.mockResolvedValueOnce(first).mockImplementationOnce(async(_operation,payload)=>{
   expect(put).not.toHaveBeenCalled();expect(payload.recovery.attempt).toBe(1);expect(payload.recovery.candidateId).toBe(args.candidate.id);expect(payload.recovery.parentFingerprint).toMatch(/^[a-f0-9]{64}$/);expect(payload.recovery.generation).toMatch(/^[a-f0-9]{64}$/);
   expect(payload.project.currentTargets[0].content).toContain(before);expect(payload.recovery.previousOutput[0]?.content??"").toHaveLength(Math.min(bad.length,12000));return output();
  });
  const built=await buildServerExperimentCandidate(args.project,args.candidate);const snapshot=built.artifactSnapshots[0]!;
  expect(ai).toHaveBeenCalledTimes(2);expect(put).toHaveBeenCalledOnce();expect(snapshot.content).toBe(original.replace(before,after));expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(snapshot.content);expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);expect(snapshot.notes?.join(" ")).toContain("构造修复");
 });
 it("repairs a wrong HTML output suffix once on the same construction boundary",async()=>{
  const args=fixture();const first=output();first.artifacts[0]!.name="candidate.zip";
  ai.mockResolvedValueOnce(first).mockImplementationOnce(async(_operation,payload)=>{
   expect(payload.recovery.attempt).toBe(1);expect(payload.recovery.failure.code).toBe("text-format");
   expect(payload.recovery.candidateId).toBe(args.candidate.id);expect(put).not.toHaveBeenCalled();return output();
  });
  const built=await buildServerExperimentCandidate(args.project,args.candidate);const snapshot=built.artifactSnapshots[0]!;
  expect(ai).toHaveBeenCalledTimes(2);expect(put).toHaveBeenCalledOnce();expect(snapshot.name).toBe("evolved.html");
  expect(snapshot.frozenArtifact!.name).toBe(snapshot.name);expect(snapshot.content).toBe(original.replace(before,after));
  expect(await verifyServerCandidateFrozenArtifact(snapshot,args.source)).toBe(true);
 });
 it("repairs a missing legitimate Target atomically while preserving the other complete file",async()=>{
  const args=fixture();const text="Preserve this second complete file.";const other=SourceArtifactSchema.parse({...args.source,id:"other",name:"other.md",extension:"md",mimeType:"text/markdown",size:Buffer.byteLength(text),textContent:"STALE"});args.project.sourceArtifacts.push(other);blobs.set(other.id,new Blob([text],{type:other.mimeType}));
  ai.mockResolvedValueOnce(output()).mockImplementationOnce(async(_operation,payload)=>{expect(put).not.toHaveBeenCalled();expect(payload.recovery.failure.code).toBe("missing-target");return {summary:"all Targets",artifacts:[...output().artifacts,{sourceArtifactId:other.id,name:other.name,mimeType:other.mimeType,content:text,notes:[]}]};});
  const built=await buildServerExperimentCandidate(args.project,args.candidate);expect(ai).toHaveBeenCalledTimes(2);expect(put).toHaveBeenCalledTimes(2);expect(built.artifactSnapshots.map(snapshot=>snapshot.content)).toEqual([original.replace(before,after),text]);for(const snapshot of built.artifactSnapshots)expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
 });
 it("recovers an exact plan rejected by HTML protection without first calling the model",async()=>{
  const args=fixture();args.candidate.patches=[{id:"patch",component:"code",operation:"update",target:"原标题",content:"新标题",rationale:"错误标题变更"}];
  ai.mockImplementation(async(_operation,payload)=>{expect(payload.recovery.attempt).toBe(1);expect(put).not.toHaveBeenCalled();return output();});
  const built=await buildServerExperimentCandidate(args.project,args.candidate);expect(ai).toHaveBeenCalledOnce();expect(built.artifactSnapshots[0]!.content).toBe(original.replace(before,after));
 });
 it("retains initial and recovery failure after the one allowed retry",async()=>{
  const args=fixture();ai.mockResolvedValue(output(edit("invented anchor")));
  await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow(/首次.*修复后/);expect(ai).toHaveBeenCalledTimes(2);expect(put).not.toHaveBeenCalled();
 });
 it.each(["foreign","duplicate","foreign-before-mode","duplicate-before-mode"])("does not retry %s Artifact identities",async kind=>{
  const args=fixture();const result=output();if(kind.startsWith("foreign"))result.artifacts.push({...result.artifacts[0]!,sourceArtifactId:"unauthorized-source"});else result.artifacts.push(result.artifacts[0]!);if(kind.endsWith("before-mode"))result.artifacts[0]!.content="<html><body>invalid excerpt rewrite</body></html>";ai.mockResolvedValue(result);
  await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow();expect(ai).toHaveBeenCalledOnce();expect(put).not.toHaveBeenCalled();
 });
 it("does not retry provider failure or missing source bytes",async()=>{
  const args=fixture();ai.mockRejectedValue(new Error("model unavailable"));await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("model unavailable");expect(ai).toHaveBeenCalledOnce();
  ai.mockClear();blobs.clear();await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("父代 Artifact Blob");expect(ai).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
 it("does not regenerate after a persistent write/readback failure",async()=>{
  const args=fixture();ai.mockResolvedValue(output());put.mockRejectedValue(new Error("storage unavailable"));await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("storage unavailable");expect(ai).toHaveBeenCalledOnce();
 });
 it("does not regenerate after frozen readback failure",async()=>{
  const args=fixture();ai.mockResolvedValue(output());put.mockImplementation(async(id:string)=>{blobs.set(id,new Blob(["corrupted store bytes"]));});await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("回读校验失败");expect(ai).toHaveBeenCalledOnce();expect(put).toHaveBeenCalledOnce();
 });
 it("does not ask the model to replace an unsupported binary Materializer",async()=>{
  const args=fixture();args.source.extension="bin";args.source.mimeType="application/octet-stream";args.source.name="original.bin";ai.mockResolvedValue(output());await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("暂无 Server 原格式 Materializer");expect(ai).toHaveBeenCalledOnce();expect(put).not.toHaveBeenCalled();
 });
 it("pins recovery to the same actual parent instead of drifting to changed bytes",async()=>{
  const args=fixture();ai.mockImplementationOnce(async()=>{const changed=original.replace("原标题","新标题");blobs.set("source",new Blob([changed],{type:"text/html"}));return output(edit("invented anchor"));}).mockResolvedValueOnce(output());
  await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow(/构造期间.*父代/);expect(ai).toHaveBeenCalledOnce();expect(put).not.toHaveBeenCalled();
 });
 it("preflights a later Target's required original protection baseline before asking the model",async()=>{
  const args=fixture();const other=SourceArtifactSchema.parse({...args.source,id:"other",name:"other.html"});args.project.sourceArtifacts.push(other);blobs.set(other.id,new Blob([original],{type:other.mimeType}));
  const parent=await materializeServerCandidateArtifacts(args.project,args.candidate,[...output().artifacts,{...output().artifacts[0]!,sourceArtifactId:other.id}],"parent");args.project.searchChampion={candidate:parent,validation:{status:"completed",candidateId:parent.id,recommendation:"release"},artifactAcceptance:{status:"passed",candidateId:parent.id}} as EvolveProject["searchChampion"];
  blobs.delete(other.id);put.mockClear();ai.mockResolvedValue(output(edit("invented anchor")));
  await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("父代 Artifact Blob");expect(ai).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
 it("rejects same-size original protection drift without repair or freezing new bytes",async()=>{
  const args=fixture();const parent=await materializeServerCandidateArtifacts(args.project,args.candidate,output().artifacts,"parent");args.project.searchChampion={candidate:parent,validation:{status:"completed",candidateId:parent.id,recommendation:"release"},artifactAcceptance:{status:"passed",candidateId:parent.id}} as EvolveProject["searchChampion"];
  args.candidate.designRationale!.sourceEvidence=[after];put.mockClear();ai.mockImplementation(async()=>{blobs.set(args.source.id,new Blob([original.replace("原标题","新标题")],{type:args.source.mimeType}));return output(edit(after,after+"<p>新增步骤</p>"));});
  await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("原始保护基线发生变化");expect(ai).toHaveBeenCalledOnce();expect(put).not.toHaveBeenCalled();
 });
 it("accounts for verified anchor strings within every Target and overall text context budget",async()=>{
  const args=fixture();args.project.sourceArtifacts=Array.from({length:5},(_,index)=>SourceArtifactSchema.parse({...args.source,id:"source-"+index}));
  const contexts=await buildServerCandidateTargetContext(args.project,args.candidate,async()=>original);const chars=contexts.map(context=>context.content.length+context.verifiedAnchors.reduce((sum,anchor)=>sum+anchor.text.length,0));expect(chars.every(total=>total<=22000)).toBe(true);expect(chars.reduce((sum,total)=>sum+total,0)).toBeLessThanOrEqual(72000);expect(contexts[0]!.verifiedAnchors[0]!.text).toBe(before);
 });
 it("rechecks an accepted parent's frozen identity without invoking repair",async()=>{
  const args=fixture();const parent=await materializeServerCandidateArtifacts(args.project,args.candidate,output().artifacts,"parent");args.project.searchChampion={candidate:parent,validation:{status:"completed",candidateId:parent.id,recommendation:"release"},artifactAcceptance:{status:"passed",candidateId:parent.id}} as EvolveProject["searchChampion"];
  blobs.set(parent.artifactSnapshots[0]!.frozenArtifact!.blobId,new Blob(["tampered"]));put.mockClear();
  await expect(buildServerExperimentCandidate(args.project,args.candidate)).rejects.toThrow("冻结文件");expect(ai).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
 });
});
