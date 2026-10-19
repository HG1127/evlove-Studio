// @vitest-environment node
import JSZip from "jszip";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CandidateArtifactSnapshot, EvolveProject, SourceArtifact, TargetRunResult, TestCase } from "@evolution/contracts";
import { applyServerCodebaseOverlay, composeServerCodebaseOverlay, resolveServerExperimentParentBinding } from "./server-experiment";
import { materializeServerCandidateArtifacts, serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";

import { runServerHttpTargetBatch } from "./server-http-target-execution";

const {getBlob,putBlob}=vi.hoisted(()=>({getBlob:vi.fn(),putBlob:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:getBlob,put:putBlob})}));

async function baseZip(){
  const zip=new JSZip();
  zip.file("src/a.ts","export const a = 1;\n");
  zip.file("src/keep.ts","export const keep = true;\n");
  return new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:"application/zip"});
}

function source():SourceArtifact{
  return {
    id:"source-zip",name:"repo.zip",role:"target",artifactKind:"codebase",mimeType:"application/zip",
    size:100,extension:"zip",inputMode:"upload",parseStatus:"ready",textContent:"",textExcerpt:"",
    structure:["src/a.ts","src/keep.ts"],warnings:[],createdAt:"2026-09-20T13:00:00.000Z",
    artifactDescriptor:{family:"codebase",adapterId:"codebase-zip-repository",preservationMode:"preserve-package",capabilities:{parse:true,mutate:true,materialize:true,roundtrip:true}},
  } as unknown as SourceArtifact;
}

function projectWithChampion(frozen:boolean):EvolveProject{
  const artifact=source();
  const candidate={
    id:"candidate-s1",name:"S1",change:"change",patches:[],addressesAdvice:[],riskLevel:"low" as const,risks:[],
    accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS" as const,recommended:true,status:"winner" as const,notes:[],
    artifactBuildStatus:"ready" as const,
    artifactSnapshots:[{
      id:"snap-s1",sourceArtifactId:artifact.id,name:artifact.name,mimeType:artifact.mimeType,
      content:'{"kind":"codebase","overlay":true,"files":[{"path":"src/a.ts","content":"export const a = 2;\\n"}]}',
      contentHash:"hash-s1",buildMode:"ai-full" as const,notes:[],createdAt:"2026-09-20T13:10:00.000Z",
      ...(frozen?{frozenArtifact:{sourceArtifactId:artifact.id,snapshotHash:"hash-s1",blobId:"champion-blob",name:artifact.name,mimeType:artifact.mimeType,sha256:"sha-champion",size:120,verifiedAt:"2026-09-20T13:10:00.000Z",checks:["zip"],limitations:[]}}:{}),
    }],
  };
  const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS" as const,averageCost:0,averageLatencyMs:1,notes:[],failures:[]};
  return {
    version:"V1",sourceArtifacts:[artifact],
    searchChampion:{
      id:"champion-s1",versionLabel:"S1",round:1,score:90,candidate,evaluation,
      validation:{id:"validation",status:"completed",candidateId:candidate.id,recommendation:"release",evaluation,checks:[],runs:[],baselineRuns:[]},
      artifactAcceptance:{id:"accept",status:"passed",candidateId:candidate.id,overallScore:90,coverageScore:90,integrityScore:90,pairwiseScore:90,hardGatePass:true,results:[],attempts:0,maxRepairAttempts:3,summary:"accepted"},
      patches:[],parentVersionId:"V1",reason:"accepted",selectedAt:"2026-09-20T13:10:00.000Z",
    },
  } as unknown as EvolveProject;
}

describe("server experiment materialization",()=>{
  it("applies code changes onto the real parent ZIP and preserves untouched entries",async()=>{
    const result=await applyServerCodebaseOverlay(await baseZip(),JSON.stringify({
      kind:"codebase",overlay:true,files:[{path:"src/a.ts",content:"export const a = 2;\n"}],
    }));
    const zip=await JSZip.loadAsync(new Uint8Array(await result.blob.arrayBuffer()),{checkCRC32:true});
    expect(await zip.file("src/a.ts")?.async("string")).toBe("export const a = 2;\n");
    expect(await zip.file("src/keep.ts")?.async("string")).toBe("export const keep = true;\n");
  });

  it("rejects path traversal in codebase overlays",async()=>{
    await expect(applyServerCodebaseOverlay(await baseZip(),JSON.stringify({
      kind:"codebase",overlay:true,files:[{path:"../escape.ts",content:"bad"}],
    }))).rejects.toThrow("无效");
  });

  it("applies explicit deletions without dropping unrelated parent files",async()=>{
    const result=await applyServerCodebaseOverlay(await baseZip(),JSON.stringify({
      kind:"codebase",overlay:true,files:[],deletions:["src/a.ts"],
    }));
    const zip=await JSZip.loadAsync(new Uint8Array(await result.blob.arrayBuffer()),{checkCRC32:true});
    expect(zip.file("src/a.ts")).toBeNull();
    expect(await zip.file("src/keep.ts")?.async("string")).toBe("export const keep = true;\n");
  });

  it("composes accepted codebase overlay metadata cumulatively across rounds",()=>{
    const parent=JSON.stringify({kind:"codebase",overlay:true,files:[
      {path:"src/a.ts",content:"a2"},
      {path:"src/old.ts",content:"old"},
    ],deletions:["src/deleted.ts"]});
    const delta=JSON.stringify({kind:"codebase",overlay:true,files:[
      {path:"src/a.ts",content:"a3"},
      {path:"src/new.ts",content:"new"},
    ],deletions:["src/old.ts"]});
    const composed=JSON.parse(composeServerCodebaseOverlay(parent,delta)) as {files:Array<{path:string;content:string}>;deletions:string[]};
    expect(Object.fromEntries(composed.files.map((file)=>[file.path,file.content]))).toEqual({"src/a.ts":"a3","src/new.ts":"new"});
    expect(new Set(composed.deletions)).toEqual(new Set(["src/deleted.ts","src/old.ts"]));
  });

  it("binds a first-cycle Candidate parent to the Source storageRef",()=>{
    const project=projectWithChampion(false);
    delete project.searchChampion;
    project.sourceArtifacts[0]!.storageRef="raw-zip";
    expect(resolveServerExperimentParentBinding(project,project.sourceArtifacts[0]!)).toMatchObject({
      blobId:"raw-zip",candidateId:undefined,
    });
  });

  it("materializes a first-cycle Candidate from the referenced Source ZIP",async()=>{
    const project=projectWithChampion(false);
    const candidate=project.searchChampion!.candidate!;
    delete project.searchChampion;
    project.sourceArtifacts[0]!.storageRef="raw-zip";
    const base=await baseZip();
    const saved=new Map<string,Blob>();
    getBlob.mockReset().mockImplementation(async(id:string)=>id==="raw-zip"?base:saved.get(id));
    putBlob.mockReset().mockImplementation(async(id:string,blob:Blob)=>{saved.set(id,blob);});
    const result=await materializeServerCandidateArtifacts(project,candidate,[{
      sourceArtifactId:"source-zip",name:"repo.zip",mimeType:"application/zip",
      content:JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/a.ts",content:"export const a = 2;\n"}]}),
    }],"test");
    expect(getBlob).toHaveBeenCalledWith("raw-zip");
    const frozen=result.artifactSnapshots[0]?.frozenArtifact;
    expect(frozen?.blobId).toMatch(/^server-candidate:/);
    const zip=await JSZip.loadAsync(new Uint8Array(await saved.get(frozen!.blobId)!.arrayBuffer()),{checkCRC32:true});
    expect(await zip.file("src/a.ts")?.async("string")).toBe("export const a = 2;\n");
    expect(await zip.file("src/keep.ts")?.async("string")).toBe("export const keep = true;\n");
  });

  it("does not substitute a missing source storageRef with its metadata ID",async()=>{
    const project=projectWithChampion(false);
    const candidate=project.searchChampion!.candidate!;
    delete project.searchChampion;
    project.sourceArtifacts[0]!.storageRef="raw-zip";
    getBlob.mockReset().mockResolvedValue(undefined);
    putBlob.mockReset();
    await expect(materializeServerCandidateArtifacts(project,candidate,[{
      sourceArtifactId:"source-zip",name:"repo.zip",mimeType:"application/zip",
      content:JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/a.ts",content:"export const a = 2;\n"}]}),
    }],"test")).rejects.toThrow("raw-zip");
    expect(getBlob).toHaveBeenCalledOnce();
    expect(getBlob).toHaveBeenCalledWith("raw-zip");
    expect(putBlob).not.toHaveBeenCalled();
  });
  it("rejects a frozen Champion parent whose stored size differs",async()=>{
    const project=projectWithChampion(true);
    const candidate=project.searchChampion!.candidate!;
    getBlob.mockReset().mockResolvedValue(new Blob(["short"]));
    putBlob.mockReset();
    await expect(materializeServerCandidateArtifacts(project,candidate,[{
      sourceArtifactId:"source-zip",name:"repo.zip",mimeType:"application/zip",
      content:JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/a.ts",content:"export const a = 3;\n"}]}),
    }],"test")).rejects.toThrow("大小校验失败");
    expect(getBlob).toHaveBeenCalledWith("champion-blob");
    expect(putBlob).not.toHaveBeenCalled();
  });
  it("does not use the Source as a parent when the Champion lacks its Target snapshot",()=>{
    const project=projectWithChampion(true);
    project.sourceArtifacts[0]!.storageRef="raw-zip";
    project.searchChampion!.candidate!.artifactSnapshots=[];
    const binding=resolveServerExperimentParentBinding(project,project.sourceArtifacts[0]!);
    expect(binding.blobId).toBeUndefined();
    expect(binding.reason).toContain("不能回退原 Source");
  });

  it("does not use the Source as a parent when the Champion is untrusted",()=>{
    const project=projectWithChampion(true);
    project.searchChampion!.validation!.recommendation="hold";
    const binding=resolveServerExperimentParentBinding(project,project.sourceArtifacts[0]!);
    expect(binding.blobId).toBeUndefined();
    expect(binding.reason).toContain("可信 Artifact Snapshot");
  });
  it("refuses ambiguous accepted Champion snapshots as a Candidate parent",()=>{
    const project=projectWithChampion(true);
    const candidate=project.searchChampion!.candidate!;
    candidate.artifactSnapshots.push({...candidate.artifactSnapshots[0]!,id:"duplicate-parent"});
    const binding=resolveServerExperimentParentBinding(project,project.sourceArtifacts[0]!);
    expect(binding.blobId).toBeUndefined();
    expect(binding.reason).toContain("唯一可信");
  });
  it("never falls back to the original Source when the accepted Champion is not frozen",()=>{
    const project=projectWithChampion(false);
    const binding=resolveServerExperimentParentBinding(project,project.sourceArtifacts[0]!);
    expect(binding.blobId).toBeUndefined();
    expect(binding.reason).toContain("不能回退原 Source");
  });

  it("binds a new code Candidate to the accepted Champion frozen ZIP when available",()=>{
    const project=projectWithChampion(true);
    expect(resolveServerExperimentParentBinding(project,project.sourceArtifacts[0]!)).toMatchObject({
      blobId:"champion-blob",candidateId:"candidate-s1",sha256:"sha-champion",
    });
  });
});
describe("server frozen receipt execution recheck", () => {
  it("requires a frozen text Blob to equal the complete Candidate Snapshot", async () => {
    vi.stubGlobal("crypto", webcrypto);
    try {
      const content = "expected";
      const snapshotHash = await serverArtifactSha256(new TextEncoder().encode(content));
      const wrong = new NodeBlob(["different"], { type: "text/markdown" });
      const wrongSha = await serverArtifactSha256(await wrong.arrayBuffer());
      const snapshot = {
        id: "text-snap", sourceArtifactId: "guide", name: "guide.md", mimeType: "text/markdown", content,
        contentHash: snapshotHash, buildMode: "ai-full", notes: [], createdAt: "2026-09-27T00:00:00.000Z",
        frozenArtifact: { sourceArtifactId: "guide", snapshotHash, blobId: "text-blob", name: "guide.md", mimeType: "text/markdown", sha256: wrongSha, size: wrong.size, verifiedAt: "2026-09-27T00:00:00.000Z", checks: [], limitations: [] },
      } as CandidateArtifactSnapshot;
      getBlob.mockReset().mockResolvedValue(wrong);
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
      const correct = new NodeBlob([content], { type: "text/markdown" });
      getBlob.mockResolvedValue(correct);
      snapshot.frozenArtifact!.sha256 = await serverArtifactSha256(await correct.arrayBuffer());
      snapshot.frozenArtifact!.size = correct.size;
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("binds Snapshot content and persisted Blob bytes before claiming a binary roundtrip", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const content = JSON.stringify({ kind: "codebase", overlay: true, files: [{ path: "src/app.ts", content: "v2" }] });
    const blob = new NodeBlob(["actual materialized zip bytes"], { type: "application/zip" });
    const sha256 = await serverArtifactSha256(await blob.arrayBuffer());
    const snapshotHash = await serverArtifactSha256(new TextEncoder().encode(content));
    const snapshot = {
      id: "snap", sourceArtifactId: "repo", name: "repo.zip", mimeType: "application/zip", content,
      contentHash: snapshotHash, buildMode: "ai-full", notes: [], createdAt: "2026-09-27T00:00:00.000Z",
      frozenArtifact: { sourceArtifactId: "repo", snapshotHash, blobId: "server-candidate:sha", name: "repo.zip", mimeType: "application/zip", sha256, size: blob.size, verifiedAt: "2026-09-27T00:00:00.000Z", checks: [], limitations: [] },
    } as CandidateArtifactSnapshot;
    getBlob.mockReset().mockResolvedValue(blob);
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
    expect(getBlob).toHaveBeenCalledWith("server-candidate:sha");
    expect(await verifyServerCandidateFrozenArtifact({ ...snapshot, content: content + "changed" })).toBe(false);
    getBlob.mockResolvedValue(new NodeBlob(["tampered materialized bytes"], { type: "application/zip" }));
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
    getBlob.mockResolvedValue(undefined);
    expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
    vi.unstubAllGlobals();
  });
});


describe("server renamed Candidate byte identity", () => {
  it("materializes and executes the same renamed HTML file with actual MIME metadata", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("Blob", NodeBlob);
    try {
      const project = projectWithChampion(false);
      const candidate = project.searchChampion!.candidate!;
      project.searchChampion = undefined;
      const original = project.sourceArtifacts[0]!;
      Object.assign(original, {name: "index.html", extension: "html", mimeType: "text/html", artifactKind: "document", artifactDescriptor: undefined, textContent: "<html><body>original</body></html>"});
      project.targetConnection = {adapter: "http", connectionId: "runner", status: "connected", label: "runner"};
      original.size=Buffer.byteLength(original.textContent!);
      const saved = new Map<string, Blob>([[original.id,new Blob([original.textContent!],{type:original.mimeType})]]);
      getBlob.mockReset().mockImplementation(async (id: string) => saved.get(id));
      putBlob.mockReset().mockImplementation(async (id: string, blob: Blob) => {saved.set(id, blob);});
      const content = "<html><body>changed actual file</body></html>";
      const built = await materializeServerCandidateArtifacts(project, candidate, [{sourceArtifactId: original.id, name: "index-evolved.html", mimeType: "application/json", content}], "candidate");
      const snapshot = built.artifactSnapshots[0]!;
      const receipt = snapshot.frozenArtifact!;
      expect(snapshot).toMatchObject({name: "index-evolved.html", mimeType: "text/html"});
      expect(receipt).toMatchObject({name: snapshot.name, mimeType: snapshot.mimeType, snapshotHash: snapshot.contentHash});
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
      const testCase = {id: "BROWSER", title: "actual candidate", input: "run", expected: [], tags: [], hidden: true, criterionIds: [], executionMode: "external-runner", evidenceScope: "product-behavior"} as TestCase;
      const runTarget = vi.fn(async (raw: unknown) => {
        expect((raw as {artifact: {name: string; content: string}}).artifact).toEqual({name: snapshot.name, content});
        return {testCaseId: testCase.id, output: "observed", verificationStatus: "verified", artifactHash: receipt.sha256, latencyMs: 1, cost: 0, trace: []} as TargetRunResult;
      });
      const [result] = await runServerHttpTargetBatch(project, [testCase], built, {getArtifact: getBlob, runTarget, attachVisual: async (_p, _t, runs) => runs});
      expect(result?.verificationStatus, result?.output).toBe("verified");
      expect(runTarget).toHaveBeenCalledOnce();
      expect(await saved.get(receipt.blobId)!.text()).toBe(content);
      snapshot.frozenArtifact = {...receipt, name: "old.html"};
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
      snapshot.frozenArtifact = {...receipt, mimeType: "application/json"};
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
