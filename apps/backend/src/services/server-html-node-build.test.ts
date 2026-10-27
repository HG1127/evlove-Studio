// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,ExperimentPolicySchema,SourceArtifactSchema,type EvolveProject} from "@evolution/contracts";
import {buildServerExperimentCandidate,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";

const {blobs,ai}=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),put:async(id:string,blob:Blob)=>{blobs.set(id,blob);}})}));
vi.mock("./ai-gateway",()=>({runServerAi:ai}));
const original='<html><head><script>const PRIVATE_PROGRAM=1;</script><style>p{color:magenta}</style></head><body><article id="config"><p>工具</p><p>工具</p></article></body></html>';
function fixture(){
 const source=SourceArtifactSchema.parse({id:"source",name:"config.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",size:Buffer.byteLength(original),inputMode:"upload",parseStatus:"ready",textContent:"STALE INDEX",createdAt:"2026-10-27T00:00:00Z"});
 const candidate=CandidateSchema.parse({id:"node-build",name:"补齐参数",change:"补齐第二处工具说明",patches:[{id:"p",component:"code",operation:"update",target:"第二处工具说明",artifactId:source.id,content:"参数和检查",rationale:"保留原信息并细化"}]});
 const project={id:"node-mission",name:"配置说明",version:"V1",sourceArtifacts:[source],goal:"完整保留并细化配置",evolutionCommand:"补齐参数、默认值及检查",protectedItems:[],editableItems:[],acceptanceRubric:[],experimentPolicy:ExperimentPolicySchema.parse({htmlBuildAnchorValidation:"issued-body-nodes-v1"})} as unknown as EvolveProject;
 blobs.set(source.id,new Blob([original],{type:source.mimeType}));vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",project.id);
 return {project,candidate};
}
const output=(anchorId:string,after:string)=>({summary:"补齐配置",artifacts:[{sourceArtifactId:"source",name:"config.html",mimeType:"text/html",notes:[],content:JSON.stringify({kind:"html-build-body-node-edits-v1",edits:[{anchorId,after}]})}]});
beforeEach(()=>{blobs.clear();ai.mockReset();});
afterEach(()=>vi.unstubAllEnvs());

describe("issued HTML node proposal to physical frozen file",()=>{
 it("preserves full raw replacement capability and freezes exactly the selected repeated node",async()=>{
  const {project,candidate}=fixture();let expected="";
  ai.mockImplementationOnce(async(_operation,payload)=>{
   const target=payload.project.currentTargets[0];expect(target).toMatchObject({bodyAnchorPolicy:"issued-body-nodes-v1",mutationMode:"html-build-body-node-edits-v1"});
   expect(payload.outputInstruction).toContain("For an unchanged text Target with mutationMode text-edits,");
   expect(payload.htmlBodyContextInstruction).toContain("complete RAW replacement");
   expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_PROGRAM|magenta|STALE INDEX|finalHoldout/);
   const node=target.htmlBuildBodyContext.anchors.filter((a:{before:string})=>a.before==="工具")[1],after="工具</p><p><strong>具体参数</strong>与完成检查 🚀";
   expected=original.slice(0,node.start)+after+original.slice(node.end);return output(node.anchorId,after);
  });
  const built=await buildServerExperimentCandidate(project,candidate),snapshot=built.artifactSnapshots[0]!;
  expect(snapshot.content).toBe(expected);expect(snapshot.content).toContain('<p>工具</p><p>工具</p><p><strong>具体参数</strong>');
  expect(await blobs.get(snapshot.frozenArtifact!.blobId)!.text()).toBe(expected);
  expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);expect(ai).toHaveBeenCalledOnce();
 });
 it("rejects a changed physical parent even if the chosen node still matches",async()=>{
  const {project,candidate}=fixture();
  ai.mockImplementationOnce(async(_operation,payload)=>{
   const node=payload.project.currentTargets[0].htmlBuildBodyContext.anchors.filter((a:{before:string})=>a.before==="工具")[1];
   const changed=original.replace("<p>工具</p>","<p>物件</p>");expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
   blobs.set("source",new Blob([changed],{type:"text/html"}));return output(node.anchorId,"工具与默认参数");
  });
  await expect(buildServerExperimentCandidate(project,candidate)).rejects.toMatchObject({code:"CANDIDATE_BUILD_PARENT_CHANGED"});
  expect(ai).toHaveBeenCalledOnce();expect([...blobs.keys()]).toEqual(["source"]);
 });
 it("does not turn unknown IDs into another candidate or premature writes",async()=>{
  const {project,candidate}=fixture();ai.mockResolvedValue(output("invented","具体参数"));
  await expect(buildServerExperimentCandidate(project,candidate)).rejects.toThrow(/unknown/);
  expect(ai).toHaveBeenCalledOnce();expect([...blobs.keys()]).toEqual(["source"]);
 });
 it("retains the existing protection gate after binding node IDs",async()=>{
  const {project,candidate}=fixture();
  ai.mockImplementationOnce(async(_operation,payload)=>{
   const node=payload.project.currentTargets[0].htmlBuildBodyContext.anchors.filter((a:{before:string})=>a.before==="工具")[1];
   return output(node.anchorId,'工具<span id="config">新增重复 ID</span>');
  });
  await expect(buildServerExperimentCandidate(project,candidate)).rejects.toThrow(/重复 ID/);
  expect(ai).toHaveBeenCalledOnce();expect([...blobs.keys()]).toEqual(["source"]);
 });
 it("keeps an unchanged Markdown Target's original byte identity beside a changed HTML Target",async()=>{
  const {project,candidate}=fixture(),markdown="# Existing complete source\n";
  project.sourceArtifacts.push(SourceArtifactSchema.parse({...project.sourceArtifacts[0],id:"markdown",name:"readme.md",extension:"md",mimeType:"text/markdown",size:Buffer.byteLength(markdown)}));
  blobs.set("markdown",new Blob([markdown],{type:"text/markdown"}));
  ai.mockImplementationOnce(async(_operation,payload)=>{
   const htmlTarget=payload.project.currentTargets.find((t:{id:string})=>t.id==="source"),mdTarget=payload.project.currentTargets.find((t:{id:string})=>t.id==="markdown");
   expect(mdTarget.mutationMode).toBe("full");expect(mdTarget.bodyAnchorPolicy).toBeUndefined();
   const node=htmlTarget.htmlBuildBodyContext.anchors.filter((a:{before:string})=>a.before==="工具")[1];
   return {summary:"补齐参数，保留参考说明",artifacts:[...output(node.anchorId,"工具与具体参数").artifacts,{sourceArtifactId:"markdown",name:"readme.md",mimeType:"text/markdown",content:markdown,notes:[]}]};
  });
  const built=await buildServerExperimentCandidate(project,candidate);expect(built.artifactSnapshots).toHaveLength(2);
  const md=built.artifactSnapshots.find(s=>s.sourceArtifactId==="markdown")!;
  expect(md.content).toBe(markdown);expect(await blobs.get(md.frozenArtifact!.blobId)!.text()).toBe(markdown);
  expect(await verifyServerCandidateFrozenArtifact(md)).toBe(true);
 });
 it("refuses missing explicit body consent before any provider request",async()=>{
  const {project,candidate}=fixture();vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS","");
  await expect(buildServerExperimentCandidate(project,candidate)).rejects.toThrow(/authorized body context/);
  expect(ai).not.toHaveBeenCalled();expect([...blobs.keys()]).toEqual(["source"]);
 });
 it("does not freeze a fake mutation when every selected node is unchanged",async()=>{
  const {project,candidate}=fixture();
  ai.mockImplementationOnce(async(_operation,payload)=>{
   const node=payload.project.currentTargets[0].htmlBuildBodyContext.anchors[0];return output(node.anchorId,node.before);
  });
  await expect(buildServerExperimentCandidate(project,candidate)).rejects.toThrow();
  expect(ai).toHaveBeenCalledOnce();expect([...blobs.keys()]).toEqual(["source"]);
 });
});
