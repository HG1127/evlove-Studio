// @vitest-environment node
import {createHash} from "node:crypto";
import JSZip from "jszip";
import {describe,expect,it,vi} from "vitest";
import {CandidateSchema,type Candidate,type EvolveProject} from "@evolution/contracts";
import {expectedServerHttpReleaseByteHashes,prepareServerHttpReleaseArtifacts} from "./server-http-release-artifacts";

function fixture(){
  const contents=["<html>accepted</html>","zip-frozen-bytes"];
  const sources=["html-source","zip-source"];
  const snapshots=sources.map((sourceArtifactId,index)=>({
    id:`snapshot-${index}`,sourceArtifactId,name:index===0?"index.html":"repo.zip",
    mimeType:index===0?"text/html":"application/zip",content:contents[index]!,contentHash:`snapshot-hash-${index}`,
    buildMode:"ai-full" as const,notes:[],createdAt:"2026-09-22T00:00:00Z",
  }));
  const frozen=snapshots.map((snapshot,index)=>({
    sourceArtifactId:snapshot.sourceArtifactId,snapshotHash:snapshot.contentHash,blobId:`frozen-${index}`,
    name:snapshot.name,mimeType:snapshot.mimeType,sha256:createHash("sha256").update(contents[index]!).digest("hex"),
    size:Buffer.byteLength(contents[index]!),verifiedAt:"2026-09-22T00:01:00Z",checks:["byte-readback"],limitations:[],
  }));
  const candidate={id:"C1",name:"accepted",change:"x",patches:[],artifactSnapshots:snapshots} as unknown as Candidate;
  const project={
    id:"release-mission",
    sourceArtifacts:sources.map((id,index)=>({id,role:"target",name:snapshots[index]!.name})),
    searchChampion:{candidate,artifactAcceptance:{status:"passed",candidateId:"C1",frozenArtifacts:frozen}},
  } as unknown as EvolveProject;
  const get=vi.fn(async(id:string)=>{
    const index=frozen.findIndex((item)=>item.blobId===id);
    return index<0?undefined:new Blob([contents[index]!]);
  });
  return{project,candidate,contents,frozen,get};
}

describe("Server HTTP Release exact frozen bytes",()=>{
  it("reads every Gate F Target Blob and sends its exact bytes in stable Target order",async()=>{
    const x=fixture();
    const result=await prepareServerHttpReleaseArtifacts(x.project,x.candidate,{get:x.get});
    expect(result.candidate).toBe(x.candidate);
    expect(result.frozenArtifacts.map((item)=>item.sourceArtifactId)).toEqual(["html-source","zip-source"]);
    expect(result.frozenArtifacts.map((item)=>Buffer.from(item.contentBase64,"base64").toString())).toEqual(x.contents);
    expect(result.frozenArtifacts.map((item)=>item.sha256)).toEqual(x.frozen.map((item)=>item.sha256));
    expect(x.get).toHaveBeenCalledTimes(2);
  });

  it("derives read-only Observe expectations only from the exact accepted Gate F set",()=>{
    const x=fixture();
    expect(expectedServerHttpReleaseByteHashes(x.project,x.candidate)).toEqual(x.frozen.map((item)=>({sourceArtifactId:item.sourceArtifactId,sha256:item.sha256})));
    const drifted={...x.candidate,artifactSnapshots:x.candidate.artifactSnapshots.map((item,index)=>index?{...item,content:"changed"}:item)};
    expect(()=>expectedServerHttpReleaseByteHashes(x.project,drifted)).toThrow("Snapshot 不一致");
    x.project.searchChampion!.artifactAcceptance!.status="unverified";
    expect(()=>expectedServerHttpReleaseByteHashes(x.project,x.candidate)).toThrow("Gate F");
  });
  it("rejects a mutable Candidate copy that drifted from the Gate F Champion",async()=>{
    const x=fixture();
    const drifted={...x.candidate,artifactSnapshots:x.candidate.artifactSnapshots.map((snapshot,index)=>index?{...snapshot,content:"changed"}:snapshot)};
    await expect(prepareServerHttpReleaseArtifacts(x.project,drifted,{get:x.get})).rejects.toThrow("Snapshot 不一致");
    expect(x.get).not.toHaveBeenCalled();
  });

  it("rejects a missing Gate F acceptance before reading blobs",async()=>{
    const x=fixture();
    x.project.searchChampion!.artifactAcceptance!.status="unverified";
    await expect(prepareServerHttpReleaseArtifacts(x.project,x.candidate,{get:x.get})).rejects.toThrow("Gate F");
    expect(x.get).not.toHaveBeenCalled();
  });

  it("delivers exact frozen DOCX and keep-parent CSV bytes without regenerating either file",async()=>{
    const docx=new JSZip();
    docx.file("word/document.xml",'<w:document><w:t>进化后的正文</w:t></w:document>');
    docx.file("word/media/image.png",new Uint8Array([0,99,255,41,0]));
    const docBytes=new Uint8Array(await docx.generateAsync({type:"uint8array"}));
    const csvBytes=new TextEncoder().encode("客户,资产\r\n000123,5\r\n000124,9\r\n");
    const blobs=[docBytes,csvBytes];
    const sources=[{id:"doc",name:"report.docx",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
      {id:"csv",name:"records.csv",mimeType:"text/csv"}];
    const contents=[JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"进化后的正文"}]}]}),
      JSON.stringify({kind:"keep-parent",sourceArtifactId:"csv"})];
    const snapshots=sources.map((source,index)=>({
      id:`snapshot-${index}`,sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,
      content:contents[index]!,contentHash:createHash("sha256").update(contents[index]!).digest("hex"),
      buildMode:"ai-full" as const,notes:[],createdAt:"2026-10-21T00:00:00Z",
    }));
    const frozen=snapshots.map((snapshot,index)=>({
      sourceArtifactId:snapshot.sourceArtifactId,snapshotHash:snapshot.contentHash,
      blobId:`accepted-${index}`,name:snapshot.name,mimeType:snapshot.mimeType,
      sha256:createHash("sha256").update(blobs[index]!).digest("hex"),
      size:blobs[index]!.byteLength,verifiedAt:"2026-10-21T01:00:00Z",checks:["frozen-byte-readback"],limitations:[],
    }));
    const champion=CandidateSchema.parse({id:"accepted-mixed",name:"Candidate",change:"DOCX improved, CSV preserved",patches:[],
      artifactSnapshots:snapshots.map((snapshot,index)=>({...snapshot,frozenArtifact:frozen[index]}))});
    const mission={id:"native-output",sourceArtifacts:sources.map(source=>({...source,role:"target"})),
      searchChampion:{candidate:champion,artifactAcceptance:{status:"passed",candidateId:champion.id,frozenArtifacts:frozen}},
    } as unknown as EvolveProject;
    const get=vi.fn(async(id:string)=>{
      const index=frozen.findIndex(receipt=>receipt.blobId===id);
      if(index<0)return undefined;
      const bytes=new Uint8Array(blobs[index]!.byteLength);bytes.set(blobs[index]!);
      return new Blob([bytes.buffer],{type:sources[index]!.mimeType});
    });
    const delivered=await prepareServerHttpReleaseArtifacts(mission,champion,{get});
    expect(delivered.frozenArtifacts.map(item=>item.sourceArtifactId)).toEqual(["doc","csv"]);
    for(const [index,artifact] of delivered.frozenArtifacts.entries()){
      expect(Buffer.from(artifact.contentBase64,"base64")).toEqual(Buffer.from(blobs[index]!));
      expect(artifact.sha256).toBe(frozen[index]!.sha256);
    }
    expect(get).toHaveBeenCalledTimes(2);
    // Tampering one frozen original byte set cannot silently deliver a replacement.
    await expect(prepareServerHttpReleaseArtifacts(mission,champion,{get:async(id)=>{
      const blob=await get(id);
      return id==="accepted-1"?new Blob(["客户,资产\r\n000123,6\r\n000124,9\r\n"]):blob;
    }})).rejects.toThrow(/SHA-256/);
  });

  it("rejects missing and altered frozen bytes rather than substituting Snapshot text",async()=>{
    const x=fixture();
    await expect(prepareServerHttpReleaseArtifacts(x.project,x.candidate,{get:async(id)=>id==="frozen-1"?undefined:new Blob([x.contents[0]!])})).rejects.toThrow("找不到 Gate F 冻结 Blob");
    await expect(prepareServerHttpReleaseArtifacts(x.project,x.candidate,{get:async(id)=>new Blob([id==="frozen-1"?"zip-frozen-byteS":x.contents[0]!])})).rejects.toThrow("SHA-256 不一致");
  });
});
