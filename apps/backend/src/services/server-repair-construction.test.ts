// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,CandidateSchema,EvolutionJobSchema,ExperimentPolicySchema,SourceArtifactSchema} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {repairServerArtifactCandidate} from "./server-artifact-acceptance";
import {serverArtifactSha256,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {withServerControlExecution} from "./server-control-execution";

const m=vi.hoisted(()=>({blobs:new Map<string,Blob>(),ai:vi.fn(),put:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>m.blobs.get(id),put:m.put})}));
vi.mock("./ai-gateway",()=>({runServerAi:m.ai}));
// Only the renderer/signature admission is substituted. Actual body anchors,
// physical parent verification, Original retention and all-target preflight run.
vi.mock("@evolution/adapters/html-native-profile",async(importOriginal)=>({...await importOriginal<typeof import("@evolution/adapters/html-native-profile")>(),isKnownHtmlNativeSubject:()=>true,
  compileKnownHtmlDerivedMetadata:(_original:string,html:string)=>({html,updatedIds:[]})}));
const html='<html><body><article class="slide-card" id="slide-1"><div class="slide-body"><p><span>配置说明</span></p><ul><li>1. Phone works</li><li>2. Console works</li></ul><pre id="commands"><code>npm install</code></pre></div></article><script>PRIVATE_PROGRAM</script></body></html>';
const criterion=AcceptanceCriterionSchema.parse({id:"DETAIL",title:"具体配置",requirement:"给出保存后检查步骤"});
async function fixture(enabled=true){
 const p=acceptedPackageFixture(false).project;
 const source=SourceArtifactSchema.parse({id:"source",name:"source.html",extension:"html",mimeType:"text/html",artifactKind:"document",role:"target",inputMode:"upload",size:Buffer.byteLength(html),textContent:html,createdAt:new Date().toISOString()});
 const sha=await serverArtifactSha256(new TextEncoder().encode(html));
 const candidate=CandidateSchema.parse({id:"parent",name:"tested",change:"配置细化",artifactBuildStatus:"ready",artifactSnapshots:[{id:"snapshot",sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,content:html,contentHash:sha,createdAt:new Date().toISOString(),frozenArtifact:{sourceArtifactId:source.id,snapshotHash:sha,blobId:"parent-blob",name:source.name,mimeType:source.mimeType,sha256:sha,size:Buffer.byteLength(html),verifiedAt:new Date().toISOString(),checks:[],limitations:[]}}]});
 Object.assign(p,{id:"construction-mission",sourceArtifacts:[source],protectedItems:[],editableItems:[],acceptanceRubric:[criterion],candidates:[candidate],searchChampion:undefined});
 p.experimentPolicy=ExperimentPolicySchema.parse(enabled?{repairConstructionCorrection:"repair-construction-correction-v1"}:{});
 p.campaign={...p.campaign,currentRound:0,noImprovementRounds:0,estimatedCost:0,status:"running",startedAt:new Date().toISOString(),stopCriteria:{...p.campaign.stopCriteria,maxRounds:1,patienceRounds:1,maxWallMinutes:30,maxEstimatedCost:12,stopWhenAcceptanceMet:false,stopWhenMetricTargetsMet:false}};
 p.artifactAcceptance={...p.artifactAcceptance,status:"repairing",attempts:1,maxRepairAttempts:1};
 p.validationRun={...p.validationRun,status:"idle",evaluation:undefined};
 p.experimentRun={...p.experimentRun,status:"idle",candidateResults:[]};
 m.blobs.set("source",new Blob([html],{type:source.mimeType}));m.blobs.set("parent-blob",new Blob([html],{type:source.mimeType}));
 vi.stubEnv("EVOLUTION_AI_FULL_REPAIR_TEXT_MISSIONS",p.id);
 return {project:p,candidate,failedCriteria:[criterion],attempt:1};
}
type RepairRequest={candidate:{artifacts:Array<{htmlTextNodes:Array<{anchorId:string;text:string}>}>};failedCriteria:unknown;constructionCorrection?:unknown};
function proposal(payload:RepairRequest,bad=false){
 const nodes=payload.candidate.artifacts[0].htmlTextNodes as Array<{anchorId:string;text:string}>;
 const n=nodes.find(n=>n.text===(bad?"npm install":"配置说明"))!;
 return {summary:bad?"invalid protected replacement":"configuration clarification",repairedCriteria:[criterion.id],artifacts:[{sourceArtifactId:"source",name:"source.html",mimeType:"text/html",notes:[],content:JSON.stringify({kind:"html-body-node-edits-v1",edits:[{anchorId:n.anchorId,text:bad?"npm update":"填写项目名称，保存后回读检查。"}]})}]};
}
beforeEach(()=>{m.blobs.clear();m.ai.mockReset();m.put.mockReset();m.put.mockImplementation(async(id:string,blob:Blob)=>{m.blobs.set(id,blob);});});
afterEach(()=>vi.unstubAllEnvs());

describe("one construction correction within a claimed Artifact repair",()=>{
 it("corrects a numbered-list rejection through the existing single correction before writing",async()=>{
  const args=await fixture();
  m.ai.mockImplementationOnce(async(_op,payload:RepairRequest)=>{const n=payload.candidate.artifacts[0].htmlTextNodes.find(n=>n.text==='2. Console works')!;
    return {summary:"bad numbering",repairedCriteria:[criterion.id],artifacts:[{sourceArtifactId:"source",name:"source.html",mimeType:"text/html",notes:[],content:JSON.stringify({kind:"html-body-node-edits-v1",edits:[{anchorId:n.anchorId,text:"3. Console works"}]})}]};});
  m.ai.mockImplementationOnce(async(_op,payload)=>{expect(m.put).not.toHaveBeenCalled();expect(payload.constructionCorrection).toMatchObject({code:"HTML_NUMBERED_LIST_INCOHERENT",issues:[{section:"slide-1",listIndex:1,itemIndex:2,expectedNumber:2,observedNumber:3}]});return proposal(payload);});
  const out=await repairServerArtifactCandidate(args);
  expect(m.ai).toHaveBeenCalledTimes(2);expect(m.put).toHaveBeenCalledOnce();expect(out.artifactSnapshots[0]!.content).toContain('2. Console works');
  expect(args.project.artifactAcceptance.attempts).toBe(1);
 });
 it("keeps legacy policy terminal after a real pre-write retention rejection",async()=>{
  const args=await fixture(false);m.ai.mockImplementation(async(_op,payload)=>proposal(payload,true));
  await expect(repairServerArtifactCandidate(args)).rejects.toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"});
  expect(m.ai).toHaveBeenCalledOnce();expect(m.put).not.toHaveBeenCalled();
  expect(args.project.artifactAcceptance.attempts).toBe(1);
 });
 it("corrects once against identical private body context and freezes only the fully checked proposal",async()=>{
  const args=await fixture();const before=structuredClone(args.project);let originalPayload:RepairRequest;
  m.ai.mockImplementationOnce(async(_op,payload)=>{originalPayload=payload;return proposal(payload,true);});
  m.ai.mockImplementationOnce(async(op,payload)=>{
   expect(op).toBe("repair-artifact");expect(m.put).not.toHaveBeenCalled();
   expect(payload.candidate).toEqual(originalPayload.candidate);expect(payload.failedCriteria).toEqual(originalPayload.failedCriteria);
   expect(payload.candidate.artifacts[0].htmlParagraphGroups).toEqual([expect.objectContaining({section:"slide-1",text:"配置说明",chars:4})]);
   expect(payload.constructionCorrection).toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED",retention:{originalCount:2,retainedCount:0}});
   expect(JSON.stringify(payload)).not.toContain("PRIVATE_PROGRAM");return proposal(payload);
  });
  const result=await repairServerArtifactCandidate(args);
  expect(m.ai).toHaveBeenCalledTimes(2);expect(m.put).toHaveBeenCalledOnce();
  expect(result.artifactSnapshots[0]!.content).toBe(html.replace("配置说明","填写项目名称，保存后回读检查。"));
  expect(await verifyServerCandidateFrozenArtifact(result.artifactSnapshots[0]!)).toBe(true);
  expect(args.project).toEqual(before);
 });
 it("never attempts a third proposal when the one correction still breaks retention",async()=>{
  const args=await fixture();m.ai.mockImplementation(async(_op,payload)=>proposal(payload,true));
  await expect(repairServerArtifactCandidate(args)).rejects.toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"});
  expect(m.ai).toHaveBeenCalledTimes(2);expect(m.put).not.toHaveBeenCalled();
 });
 it.each(["wall-time","estimated-cost","round-limit"])("does not make a correction after %s exhaustion",async limit=>{
  const args=await fixture();m.ai.mockImplementation(async(_op,payload)=>{
   if(limit==="wall-time")args.project.campaign.startedAt=new Date(Date.now()-31*60_000).toISOString();
   if(limit==="estimated-cost")args.project.campaign.estimatedCost=12;
   if(limit==="round-limit")args.project.campaign.currentRound=1;
   return proposal(payload,true);
  });
  await expect(repairServerArtifactCandidate(args)).rejects.toThrow("限额");
  expect(m.ai).toHaveBeenCalledOnce();expect(m.put).not.toHaveBeenCalled();
 });
 it("does not correct after the durable control Job has been cancelled",async()=>{
  const args=await fixture(),at=new Date().toISOString();
  let job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:args.project.id,type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:control",generation:1,createdAt:at,updatedAt:at});
  m.ai.mockImplementation(async(_op,payload)=>{job={...job,status:"cancelled"};return proposal(payload,true);});
  await expect(withServerControlExecution({missionId:args.project.id,controlJobId:job.id,requestedAt:at},async()=>job,()=>repairServerArtifactCandidate(args)))
   .rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
  expect(m.ai).toHaveBeenCalledOnce();expect(m.put).not.toHaveBeenCalled();
 });
 it("never retries a persistence failure or an out-of-scope repair",async()=>{
  const args=await fixture();m.ai.mockImplementation(async(_op,payload)=>proposal(payload));m.put.mockRejectedValue(new Error("storage write failed"));
  await expect(repairServerArtifactCandidate(args)).rejects.toThrow("storage write failed");expect(m.ai).toHaveBeenCalledOnce();
  m.ai.mockReset();m.put.mockClear();m.ai.mockImplementation(async(_op,payload)=>({...proposal(payload),repairedCriteria:["OUTSIDE"]}));
  await expect(repairServerArtifactCandidate(args)).rejects.toThrow("out-of-scope");expect(m.ai).toHaveBeenCalledOnce();expect(m.put).not.toHaveBeenCalled();
 });
});
