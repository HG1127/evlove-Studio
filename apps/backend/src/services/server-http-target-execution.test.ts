// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject,TargetRunResult,TestCase} from "@evolution/contracts";
import {runServerHttpTargetBatch,serverHttpTargetEnabled} from "./server-http-target-execution";

const testCase={id:"T1",title:"真实 Target",input:"run",expected:["ok"],tags:[],hidden:false,criterionIds:[],executionMode:"external-runner",evidenceScope:"product-behavior"} as TestCase;

function frozenHtml(content:string,sourceArtifactId:string,blobId:string,snapshotHash:string){
  return{
    sourceArtifactId,snapshotHash,blobId,name:"index.html",mimeType:"text/html",
    sha256:createHash("sha256").update(content).digest("hex"),size:Buffer.byteLength(content),
    verifiedAt:"2026-09-22T00:01:00.000Z",checks:["html"],limitations:[],
  };
}
function project():EvolveProject{
  return{
    id:"http-mission",
    version:"V1",
    targetConnection:{adapter:"http",connectionId:"runner-prod",status:"connected",label:"HTTP Target"},
    sourceArtifacts:[{
      id:"html-source",name:"index.html",role:"target",artifactKind:"document",mimeType:"text/html",size:32,extension:"html",
      inputMode:"upload",parseStatus:"ready",textContent:"<html>ORIGINAL</html>",textExcerpt:"ORIGINAL",structure:[],warnings:[],createdAt:"2026-09-22T00:00:00.000Z",
    }],
  } as unknown as EvolveProject;
}

function acceptedChampion(p:EvolveProject){
  const candidate={
    id:"C-accepted",name:"accepted",change:"x",patches:[],addressesAdvice:[],riskLevel:"low",risks:[],
    accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS",recommended:true,status:"winner",notes:[],artifactBuildStatus:"ready",
    artifactSnapshots:[{id:"snap-accepted",sourceArtifactId:"html-source",name:"index.html",mimeType:"text/html",content:"<html>ACCEPTED</html>",contentHash:"accepted-hash",buildMode:"ai-full",notes:[],createdAt:"2026-09-22T00:01:00.000Z",frozenArtifact:frozenHtml("<html>ACCEPTED</html>","html-source","accepted-html","accepted-hash")}],
  } as Candidate;
  const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS" as const,averageCost:0,averageLatencyMs:1,notes:[],failures:[]};
  p.searchChampion={
    id:"S1",versionLabel:"S1",round:1,score:90,candidate,evaluation,
    validation:{id:"v",status:"completed",candidateId:candidate.id,recommendation:"release",evaluation,checks:[],runs:[],baselineRuns:[]},
    artifactAcceptance:{id:"a",status:"passed",candidateId:candidate.id,overallScore:90,coverageScore:90,integrityScore:90,pairwiseScore:90,hardGatePass:true,results:[],attempts:0,maxRepairAttempts:3,summary:"ok"},
    patches:[],parentVersionId:"V1",reason:"accepted",selectedAt:"2026-09-22T00:02:00.000Z",
  };
  return candidate;
}

describe("server HTTP Target execution",()=>{
  it("uses the accepted current HTML snapshot instead of silently falling back to original source",async()=>{
    const p=project();
    acceptedChampion(p);
    const runTarget=vi.fn(async(raw:unknown)=>{
      const input=raw as {artifact?:{content:string};variant?:unknown};
      expect(input.artifact?.content).toContain("ACCEPTED");
      expect(input.artifact?.content).not.toContain("ORIGINAL");
      expect(input.variant).toBeNull();
      const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input.artifact!.content));
      const artifactHash=[...new Uint8Array(hash)].map((v)=>v.toString(16).padStart(2,"0")).join("");
      return{testCaseId:"T1",output:"ok",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash,trace:[]} as TargetRunResult;
    });
    const getArtifact=vi.fn(async(id:string)=>id==="accepted-html"?new Blob(["<html>ACCEPTED</html>"],{type:"text/html"}):undefined);
    const result=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result[0]?.verificationStatus).toBe("verified");
    expect(runTarget).toHaveBeenCalledTimes(1);
    expect(getArtifact).toHaveBeenCalledWith("accepted-html");
  });

  it("binds candidate HTML execution to the exact candidate snapshot",async()=>{
    const p=project();
    const candidate={
      id:"C1",name:"candidate",change:"x",patches:[],addressesAdvice:[],riskLevel:"low",risks:[],
      accuracy:0,evidence:0,riskCoverage:0,costDelta:0,speedDelta:0,safety:"REVIEW",recommended:true,status:"draft",notes:[],artifactBuildStatus:"ready",
      artifactSnapshots:[{id:"snap-c1",sourceArtifactId:"html-source",name:"index.html",mimeType:"text/html",content:"<html>CANDIDATE</html>",contentHash:"c1",buildMode:"ai-full",notes:[],createdAt:"2026-09-22T00:03:00.000Z",frozenArtifact:frozenHtml("<html>CANDIDATE</html>","html-source","candidate-html","c1")}],
    } as Candidate;
    const runTarget=vi.fn(async(raw:unknown)=>{
      const input=raw as {artifact?:{content:string};variant?:Candidate};
      expect(input.artifact?.content).toContain("CANDIDATE");
      expect(input.variant?.id).toBe("C1");
      return{testCaseId:"T1",output:"runner omitted hash",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]} as TargetRunResult;
    });
    const [result]=await runServerHttpTargetBatch(p,[testCase],candidate,{runTarget,getArtifact:async(id)=>id==="candidate-html"?new Blob(["<html>CANDIDATE</html>"]):undefined,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("Artifact 指纹不一致");
  });

  it("uses the uploaded HTML storageRef bytes instead of stale parsed Source text",async()=>{
    const p=project();
    p.sourceArtifacts=[{...p.sourceArtifacts[0]!,storageRef:"uploaded-html",textContent:"<html>STALE</html>"}];
    const expected="<html>UPLOADED</html>";
    const runTarget=vi.fn(async(raw:unknown)=>{
      expect((raw as {artifact?:{content:string}}).artifact?.content).toBe(expected);
      return{testCaseId:"T1",output:"ok",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:createHash("sha256").update(expected).digest("hex"),trace:[]} as TargetRunResult;
    });
    const getArtifact=vi.fn(async(id:string)=>id==="uploaded-html"?new Blob([expected]):undefined);
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("verified");
    expect(getArtifact).toHaveBeenCalledWith("uploaded-html");
    expect(runTarget).toHaveBeenCalledOnce();
  });

  it("does not use parsed HTML text when a referenced upload is missing",async()=>{
    const p=project();
    p.sourceArtifacts=[{...p.sourceArtifacts[0]!,storageRef:"missing-upload"}];
    const runTarget=vi.fn();
    const getArtifact=vi.fn(async()=>undefined);
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("missing-upload");
    expect(getArtifact).toHaveBeenCalledWith("missing-upload");
    expect(runTarget).not.toHaveBeenCalled();
  });

  it("rejects tampered frozen Champion HTML before invoking the remote Target",async()=>{
    const p=project();
    acceptedChampion(p);
    const runTarget=vi.fn();
    const getArtifact=vi.fn(async()=>new Blob(["<html>TAMPERED</html>"]));
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("冻结凭证不一致");
    expect(runTarget).not.toHaveBeenCalled();
  });

  it("rejects a frozen HTML receipt bound to a different Snapshot before reading bytes",async()=>{
    const p=project();
    const candidate=acceptedChampion(p);
    candidate.artifactSnapshots[0]!.frozenArtifact={...candidate.artifactSnapshots[0]!.frozenArtifact!,snapshotHash:"other-snapshot"};
    const runTarget=vi.fn();
    const getArtifact=vi.fn(async()=>new Blob(["<html>ACCEPTED</html>"]));
    const [result]=await runServerHttpTargetBatch(p,[testCase],candidate,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("身份不一致");
    expect(getArtifact).not.toHaveBeenCalled();
    expect(runTarget).not.toHaveBeenCalled();
  });
  it("rejects a Candidate HTML snapshot with no frozen receipt",async()=>{
    const p=project();
    const candidate=acceptedChampion(p);
    p.searchChampion=undefined;
    candidate.artifactSnapshots[0]!.frozenArtifact=undefined;
    const runTarget=vi.fn();
    const getArtifact=vi.fn(async()=>undefined);
    const [result]=await runServerHttpTargetBatch(p,[testCase],candidate,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("尚未冻结真实文件");
    expect(getArtifact).not.toHaveBeenCalled();
    expect(runTarget).not.toHaveBeenCalled();
  });

  it("fails closed when a current accepted version lacks the exact target snapshot",async()=>{
    const p=project();
    const champion=acceptedChampion(p);
    champion.artifactSnapshots=[];
    const runTarget=vi.fn();
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact:async()=>undefined,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("不能回退原版");
    expect(runTarget).not.toHaveBeenCalled();
  });

  it("refuses duplicate accepted HTML snapshots before calling the remote Target",async()=>{
    const p=project();
    const champion=acceptedChampion(p);
    champion.artifactSnapshots.push({...champion.artifactSnapshots[0]!,id:"duplicate-html"});
    const runTarget=vi.fn();
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact:async()=>undefined,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("唯一");
    expect(runTarget).not.toHaveBeenCalled();
  });

  it("refuses duplicate accepted ZIP snapshots before reading a Blob",async()=>{
    const p=project();
    p.sourceArtifacts=[{...p.sourceArtifacts[0]!,id:"zip-source",storageRef:"raw-zip",name:"repo.zip",artifactKind:"codebase",mimeType:"application/zip",extension:"zip"}];
    const champion=acceptedChampion(p);
    champion.artifactSnapshots=[{...champion.artifactSnapshots[0]!,sourceArtifactId:"zip-source"}];
    champion.artifactSnapshots.push({...champion.artifactSnapshots[0]!,id:"duplicate-zip"});
    const runTarget=vi.fn();
    const getArtifact=vi.fn(async()=>undefined);
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("唯一");
    expect(getArtifact).not.toHaveBeenCalled();
    expect(runTarget).not.toHaveBeenCalled();
  });
  it("reads a ZIP target from the server Artifact Store and binds the remote result to its SHA-256",async()=>{
    const p=project();
    p.sourceArtifacts=[{
      id:"zip-source",storageRef:"raw-zip",name:"repo.zip",role:"target",artifactKind:"codebase",mimeType:"application/zip",size:8,extension:"zip",
      inputMode:"upload",parseStatus:"ready",textContent:"",textExcerpt:"",structure:[],warnings:[],createdAt:"2026-09-22T00:00:00.000Z",
      artifactDescriptor:{family:"codebase",adapterId:"codebase-zip",preservationMode:"preserve-package",capabilities:{parse:true,mutate:true,materialize:true,roundtrip:true}},
    }] as unknown as EvolveProject["sourceArtifacts"];
    const blob=new Blob(["zip-bytes"],{type:"application/zip"});
    const buffer=new Uint8Array(await blob.arrayBuffer());
    const hash=await crypto.subtle.digest("SHA-256",buffer);
    const expectedHash=[...new Uint8Array(hash)].map((v)=>v.toString(16).padStart(2,"0")).join("");
    const runTarget=vi.fn(async(raw:unknown)=>{
      const input=raw as {archiveBase64?:string;artifact?:unknown};
      expect(input.artifact).toBeUndefined();
      expect(Buffer.from(input.archiveBase64??"","base64").toString()).toBe("zip-bytes");
      return{testCaseId:"T1",output:"zip verified",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:expectedHash,trace:[]} as TargetRunResult;
    });
    const getArtifact=vi.fn(async(id:string)=>id==="raw-zip"?blob:undefined);
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("verified");
    expect(runTarget).toHaveBeenCalledTimes(1);
    expect(getArtifact).toHaveBeenCalledOnce();
    expect(getArtifact).toHaveBeenCalledWith("raw-zip");
  });

  it("does not fall back to the Source metadata ID when its storageRef Blob is missing",async()=>{
    const p=project();
    p.sourceArtifacts=[{...p.sourceArtifacts[0]!,id:"zip-source",storageRef:"raw-zip",name:"repo.zip",artifactKind:"codebase",mimeType:"application/zip",extension:"zip"}];
    const getArtifact=vi.fn(async()=>undefined);
    const runTarget=vi.fn();
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("raw-zip");
    expect(getArtifact).toHaveBeenCalledOnce();
    expect(getArtifact).toHaveBeenCalledWith("raw-zip");
    expect(runTarget).not.toHaveBeenCalled();
  });

  it("rejects a frozen current-version ZIP with a mismatched byte size",async()=>{
    const p=project();
    p.sourceArtifacts=[{...p.sourceArtifacts[0]!,id:"zip-source",storageRef:"raw-zip",name:"repo.zip",artifactKind:"codebase",mimeType:"application/zip",extension:"zip"}];
    const candidate=acceptedChampion(p);
    candidate.artifactSnapshots=[{
      ...candidate.artifactSnapshots[0]!,sourceArtifactId:"zip-source",name:"repo.zip",mimeType:"application/zip",
      frozenArtifact:{sourceArtifactId:"zip-source",snapshotHash:"accepted-hash",blobId:"frozen-zip",
        name:"repo.zip",mimeType:"application/zip",sha256:"sha256-accepted",size:100,
        verifiedAt:"2026-09-22T00:01:00.000Z",checks:["zip"],limitations:[]},
    }];
    const getArtifact=vi.fn(async()=>new Blob(["short"]));
    const runTarget=vi.fn();
    const [result]=await runServerHttpTargetBatch(p,[testCase],undefined,{runTarget,getArtifact,attachVisual:async(_p,_t,runs)=>runs});
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("大小与冻结凭证不一致");
    expect(getArtifact).toHaveBeenCalledWith("frozen-zip");
    expect(runTarget).not.toHaveBeenCalled();
  });
  it("only activates for an explicitly connected HTTP Target",()=>{
    const p=project();
    expect(serverHttpTargetEnabled(p)).toBe(true);
    p.targetConnection.adapter="artifact";
    expect(serverHttpTargetEnabled(p)).toBe(false);
  });
});
