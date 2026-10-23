// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,TargetRunResult,TestCase} from "@evolution/contracts";
import {executeServerArtifactExternal} from "./server-artifact-external";

const m=vi.hoisted(()=>({blobs:new Map<string,Blob>(),zip:vi.fn(),html:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>m.blobs.get(id)})}));
vi.mock("@evolution/adapters/sandbox",()=>({runVercelSandboxCodebaseValidation:m.zip}));
vi.mock("./server-html-artifact-execution",()=>({runServerHtmlArtifactBatch:m.html}));
vi.mock("./server-visual-evidence",()=>({attachServerVisualEvidence:async(_p:unknown,_t:unknown,runs:TargetRunResult[])=>runs}));
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function fixture(){
  const sources=[{id:"html",extension:"html"},{id:"zip-a",extension:"zip"},{id:"zip-b",extension:"zip"},{id:"guide",extension:"md"}]
    .map(source=>({...source,role:"target",name:source.id+"."+source.extension,storageRef:"raw-"+source.id}));
  const project={id:"mixed",sourceArtifacts:sources,acceptanceRubric:sources.map(source=>({id:source.id,artifactIds:[source.id]}))} as unknown as EvolveProject;
  const tests=sources.map(source=>({id:"test-"+source.id,criterionIds:[source.id],executionMode:"external-runner",evidenceScope:"product-behavior"})) as TestCase[];
  for(const source of sources)m.blobs.set(source.storageRef,new Blob([source.id+" source bytes"]));
  const candidate={id:"candidate",artifactSnapshots:sources.map(source=>{
    const bytes=new TextEncoder().encode(source.id+" candidate bytes"),blobId="candidate-"+source.id;
    m.blobs.set(blobId,new Blob([bytes]));
    return{sourceArtifactId:source.id,frozenArtifact:{sourceArtifactId:source.id,blobId,sha256:sha(bytes),size:bytes.length}};
  })} as unknown as Candidate;
  return{project,candidate,tests};
}
beforeEach(()=>{
  m.blobs.clear();m.zip.mockReset();m.html.mockReset();
  m.zip.mockImplementation(async({archive,testCases}:{archive:Uint8Array;testCases:TestCase[]})=>({results:testCases.map(test=>({
    testCaseId:test.id,output:new TextDecoder().decode(archive),artifactHash:sha(archive),verificationStatus:"verified",latencyMs:1,cost:0,trace:[],
  }))}));
  m.html.mockImplementation(async(_project:unknown,tests:TestCase[])=>tests.map(test=>({
    testCaseId:test.id,output:"scoped HTML runner",verificationStatus:"verified",latencyMs:1,cost:0,trace:[],
  })));
});

describe("scope-bound mixed-format external execution",()=>{
  it("keeps independent final Runner requests distinct from regression requests",async()=>{
    const {project,tests,candidate}=fixture();
    await executeServerArtifactExternal(project,[tests[1]!],"holdout",candidate);
    const regressionId=m.zip.mock.calls[0]![0].id;
    await executeServerArtifactExternal(project,[{...tests[1]!,id:"FINAL-zip-a"}],"holdout",candidate);
    expect(m.zip.mock.calls[1]![0].id).not.toBe(regressionId);
  });
  it.each(["baseline","experiment","holdout-baseline","holdout"] as const)("%s dispatches every case to its own target bytes",async phase=>{
    const {project,candidate,tests}=fixture();
    const current=phase==="experiment"||phase==="holdout"?candidate:undefined;
    const runs=await executeServerArtifactExternal(project,tests,phase,current);
    expect(runs.map(run=>run.testCaseId)).toEqual(tests.map(test=>test.id));
    expect(m.html).toHaveBeenCalledOnce();
    expect(m.html.mock.calls[0]?.[1]).toEqual([tests[0]]);
    expect(m.html.mock.calls[0]?.[2]).toBe(current);
    expect(m.zip).toHaveBeenCalledTimes(2);
    for(const [offset,id] of ["zip-a","zip-b"].entries()){
      const run=runs[offset+1]!;
      expect(run.verificationStatus).toBe("verified");
      expect(run.output).toBe(id+(current?" candidate bytes":" source bytes"));
      expect(m.zip.mock.calls[offset]?.[0].testCases).toEqual([tests[offset+1]]);
    }
    expect(runs[3]?.verificationStatus).toBe("unverified");
    expect(runs[3]?.output).toContain("暂无实际运行/视觉 Runner");
  });
  it("does not select the first ZIP for ambiguous or missing artifact scopes",async()=>{
    const {project,tests}=fixture();
    project.acceptanceRubric.push({...project.acceptanceRubric[0]!,id:"missing",artifactIds:["absent"]});
    const results=await executeServerArtifactExternal(project,[{...tests[0]!,criterionIds:[]},{...tests[1]!,criterionIds:["missing"]}],"baseline");
    expect(results.every(run=>run.verificationStatus==="unverified")).toBe(true);
    expect(m.zip).not.toHaveBeenCalled();expect(m.html).not.toHaveBeenCalled();
  });
  it("isolates a corrupt Candidate ZIP without suppressing other targets",async()=>{
    const {project,candidate,tests}=fixture();
    m.blobs.set("candidate-zip-a",new Blob(["corrupt"]));
    const runs=await executeServerArtifactExternal(project,tests,"holdout",candidate);
    expect(runs[1]?.verificationStatus).toBe("unverified");
    expect(runs[2]?.verificationStatus).toBe("verified");expect(m.zip).toHaveBeenCalledOnce();
  });
  it("rejects a Runner returning another target's hash",async()=>{
    const {project,tests}=fixture();
    m.zip.mockResolvedValue({results:[{testCaseId:tests[1]!.id,artifactHash:"a".repeat(64),verificationStatus:"verified"}]});
    const runs=await executeServerArtifactExternal(project,[tests[1]!],"baseline");
    expect(runs[0]?.verificationStatus).toBe("unverified");
  });
});
