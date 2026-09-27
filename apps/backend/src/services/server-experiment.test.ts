import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { EvolveProject, SourceArtifact } from "@evolution/contracts";
import { applyServerCodebaseOverlay, composeServerCodebaseOverlay, resolveServerExperimentParentBinding } from "./server-experiment";
import { materializeServerCandidateArtifacts } from "./server-experiment-artifacts";

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
