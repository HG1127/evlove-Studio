// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { CandidateSchema, SourceArtifactSchema, TestCaseSchema, type Candidate, type EvolveProject, type TestCase } from "@evolution/contracts";
import { executeServerBaselineExternal } from "./server-baseline";
import { runServerMissionExperiment } from "./server-experiment";
import { runServerMissionHoldout } from "./server-holdout";
const mocks=vi.hoisted(()=>({blobs:new Map<string,Blob>(),sandbox:vi.fn(),http:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>mocks.blobs.get(id)})}));
vi.mock("./server-ai-connection",()=>({withServerAiConnection:async<T>(work:()=>Promise<T>)=>work()}));
vi.mock("./ai-gateway",()=>({serverAiScoringRouteFingerprint:async()=>"independent-test-model"}));
vi.mock("./server-visual-evidence",()=>({attachServerVisualEvidence:async(_p:unknown,_t:unknown,runs:unknown)=>runs}));
vi.mock("./connector-target-source",()=>({serverConnectorTargetEnabled:()=>false}));
vi.mock("./server-http-target-execution",async(original)=>({...await original<typeof import("./server-http-target-execution")>(),runServerHttpTargetBatch:mocks.http}));
vi.mock("@evolution/adapters/sandbox",()=>({runVercelSandboxHtmlValidation:mocks.sandbox,runVercelSandboxCodebaseValidation:vi.fn()}));
vi.mock("@evolution/harness",async(original)=>({...await original<typeof import("@evolution/harness")>(),runServerExperiment:(_p:unknown,ports:unknown)=>ports,runServerHoldout:(_p:unknown,ports:unknown)=>ports}));
const original='<html><body><p id="config">Complete original configuration</p></body></html>';
const changed='<html><body><p id="config">Complete changed configuration with defaults</p></body></html>';
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
function fixture(){
  const source=SourceArtifactSchema.parse({id:"source",name:"source.html",extension:"html",mimeType:"text/html",role:"target",artifactKind:"document",inputMode:"upload",textContent:"STALE SOURCE INDEX",size:Buffer.byteLength(original),createdAt:"2026-10-12T00:00:00Z"});
  const project={id:"file-mission",sourceArtifacts:[source],acceptanceRubric:[],targetConnection:{adapter:"http",status:"connected",connectionId:"runner-gateway",label:"Historical Target Proxy"}} as unknown as EvolveProject;
  const digest=sha(changed);
  const candidate=CandidateSchema.parse({id:"changed",name:"Changed configuration",change:"Actual defaults",artifactSnapshots:[{id:"snapshot",sourceArtifactId:source.id,name:"changed.html",mimeType:"text/html",content:changed,contentHash:digest,createdAt:source.createdAt,frozenArtifact:{sourceArtifactId:source.id,snapshotHash:digest,blobId:"frozen-changed",name:"changed.html",mimeType:"text/html",sha256:digest,size:Buffer.byteLength(changed),verifiedAt:source.createdAt,checks:[],limitations:[]}}]});
  mocks.blobs.set(source.id,new Blob([original]));mocks.blobs.set("frozen-changed",new Blob([changed]));
  const cases=[TestCaseSchema.parse({id:"H1",title:"Configuration",input:"Read actual configuration",expected:["configuration"],hidden:true,executionMode:"external-runner",browserSteps:[{action:"visible",selector:"#config"}]})];
  return {project,candidate,cases};
}
type CurrentPort={executeExternalBatch:(args:{project:EvolveProject;testCases:TestCase[]})=>Promise<unknown>};
type CandidatePort={executeExternalBatch:(args:{project:EvolveProject;candidate:Candidate;testCases:TestCase[]})=>Promise<unknown>};
beforeEach(()=>{
  vi.stubEnv("EVOLUTION_TARGET_RUN_URL","");vi.stubEnv("EVOLVE_TARGET_RUN_URL","");mocks.blobs.clear();mocks.sandbox.mockReset();mocks.http.mockReset();
  mocks.sandbox.mockImplementation(async(args:{html:Uint8Array;expectedSha256:string;testCases:TestCase[]})=>({artifactHash:args.expectedSha256,results:args.testCases.map(t=>({testCaseId:t.id,output:"Injected browser observation",artifactHash:args.expectedSha256,latencyMs:1,cost:0,verificationStatus:"verified",trace:[]}))}));
});
it("all four file execution entries share exact Source/Candidate bytes and hashes without a proxy",async()=>{
  const {project,candidate,cases}=fixture();
  await executeServerBaselineExternal(project,cases);
  const experiment=await runServerMissionExperiment(project) as unknown as CandidatePort;
  await experiment.executeExternalBatch({project,candidate,testCases:cases});
  const holdout=await runServerMissionHoldout(project) as unknown as {current:CurrentPort;candidate:CandidatePort};
  await holdout.current.executeExternalBatch({project,testCases:cases});
  await holdout.candidate.executeExternalBatch({project,candidate,testCases:cases});
  expect(mocks.sandbox.mock.calls.map(([a])=>new TextDecoder().decode(a.html))).toEqual([original,changed,original,changed]);
  expect(mocks.sandbox.mock.calls.map(([a])=>a.expectedSha256)).toEqual([sha(original),sha(changed),sha(original),sha(changed)]);
  expect(mocks.sandbox.mock.calls.every(([a])=>a.testCases[0].id==="H1")).toBe(true);
  expect(mocks.http).not.toHaveBeenCalled();
});
it("a configured HTTP failure never silently changes any stage to file Sandbox",async()=>{
  vi.stubEnv("EVOLUTION_TARGET_RUN_URL","https://proxy.example/run");mocks.http.mockRejectedValue(new Error("proxy failed"));
  const {project,candidate,cases}=fixture();
  await expect(executeServerBaselineExternal(project,cases)).rejects.toThrow("proxy failed");
  const experiment=await runServerMissionExperiment(project) as unknown as CandidatePort;
  await expect(experiment.executeExternalBatch({project,candidate,testCases:cases})).rejects.toThrow("proxy failed");
  const holdout=await runServerMissionHoldout(project) as unknown as {current:CurrentPort;candidate:CandidatePort};
  await expect(holdout.current.executeExternalBatch({project,testCases:cases})).rejects.toThrow("proxy failed");
  await expect(holdout.candidate.executeExternalBatch({project,candidate,testCases:cases})).rejects.toThrow("proxy failed");
  expect(mocks.sandbox).not.toHaveBeenCalled();expect(mocks.http).toHaveBeenCalledTimes(4);
});
