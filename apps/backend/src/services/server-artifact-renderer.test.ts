// @vitest-environment node
import {createHash} from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {describe,expect,it} from "vitest";
import type {ArtifactStorePort,Candidate,EvolveProject,OutputArtifact,SourceArtifact} from "@evolution/contracts";
import {renderAcceptedProjectArtifacts,renderSnapshot,verifyRendered} from "./server-artifact-renderer";

function memoryStore(){
  const blobs=new Map<string,Blob>();
  const store:ArtifactStorePort={
    put:async(id,blob)=>{blobs.set(id,blob);},
    get:async(id)=>blobs.get(id),
    delete:async(id)=>{blobs.delete(id);},
  };
  return {store,blobs};
}

function blobFromBytes(bytes:Uint8Array,type:string){
  const copy=new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer],{type});
}

function missionFor(source:SourceArtifact,snapshot:Candidate["artifactSnapshots"][number],outputName=source.name){
  const candidate={
    id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[snapshot],
  } as unknown as Candidate;
  const acceptance={
    id:"acceptance",status:"passed" as const,candidateId:"C1",overallScore:100,coverageScore:100,integrityScore:100,pairwiseScore:100,
    hardGatePass:true,results:[],attempts:1,maxRepairAttempts:3,summary:"passed",acceptedAt:"2026-09-21T03:00:00Z",
    frozenArtifacts:[{
      sourceArtifactId:source.id,snapshotHash:snapshot.contentHash,blobId:"frozen-"+source.id,name:source.name,
      mimeType:source.mimeType,sha256:"a".repeat(64),size:source.size,verifiedAt:"now",checks:[],limitations:[],
    }],
  };
  const mission={
    id:"mission-render",name:"Render Mission",version:"V1",sourceArtifacts:[source],
    searchChampion:{
      id:"champion",round:1,versionLabel:"V1",candidate,artifactAcceptance:acceptance,
      validation:{status:"completed",candidateId:"C1"},score:100,reason:"accepted",patches:[],evaluation:null,
    },
    artifactAcceptance:acceptance,
  } as unknown as EvolveProject;
  const output={
    id:"output-1",projectId:mission.id,round:1,versionLabel:"V1",candidateId:"C1",
    name:outputName,mimeType:source.mimeType,kind:"primary" as const,content:snapshot.content,
    description:"accepted",sourceArtifactIds:[source.id],isChampion:true,accepted:true,createdAt:"now",
  } as OutputArtifact;
  return {mission,output};
}

async function freezeAccepted(mission:EvolveProject,blob:Blob,store:ArtifactStorePort){
  const receipt=mission.searchChampion!.artifactAcceptance!.frozenArtifacts![0]!;
  receipt.sha256=createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
  receipt.size=blob.size;
  receipt.mimeType=blob.type;
  await store.put(receipt.blobId,blob);
  return receipt;
}

function source(input:Partial<SourceArtifact>&Pick<SourceArtifact,"id"|"name"|"mimeType"|"extension"|"artifactKind"|"storageRef">){
  return {
    role:"target",size:1,inputMode:"upload",parseStatus:"ready",structure:[],createdAt:"now",
    ...input,
  } as SourceArtifact;
}

describe("server accepted artifact renderer",()=>{
  it("rewrites DOCX OOXML runs while preserving untouched package entries",async()=>{
    const {store,blobs}=memoryStore();
    const zip=new JSZip();
    zip.file("word/document.xml",'<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t>Keep</w:t></w:r></w:p></w:body></w:document>');
    zip.file("word/media/image1.png",new Uint8Array([1,2,3,4]));
    const raw=blobFromBytes(await zip.generateAsync({type:"uint8array"}),"application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    await store.put("raw-docx",raw);
    const src=source({
      id:"source-docx",name:"report.docx",mimeType:raw.type,extension:"docx",artifactKind:"document",storageRef:"raw-docx",
      artifactDescriptor:{
        family:"text",subtype:"docx",adapterId:"document-docx-ooxml",confidence:1,preservationMode:"same-package",
        fidelity:"high",formatExtension:"docx",editable:true,
        capabilities:{parse:true,mutate:true,materialize:true,validateStructure:true,execute:false,visual:true},
        evolutionDimensions:[],requiredValidations:[],limitations:[],
      },
    });
    const snapshot={
      id:"snap-docx",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,
      content:JSON.stringify({kind:"document",subtype:"docx",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Evolved"}]}]}),
      contentHash:"hash-docx",buildMode:"ai-full" as const,notes:[],createdAt:"now",
    };
    const {mission,output}=missionFor(src,snapshot);
    const materialized=await renderSnapshot(src,snapshot,store);
    await verifyRendered(src,snapshot,materialized.blob,store);
    const frozen=await freezeAccepted(mission,materialized.blob,store);
    const blobCount=blobs.size;
    const result=await renderAcceptedProjectArtifacts(mission,[output],store);
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({artifactRef:frozen.blobId,sha256:frozen.sha256,size:frozen.size});
    expect(blobs.size).toBe(blobCount);
    const rendered=blobs.get(result.receipts[0]!.artifactRef);
    expect(rendered).toBe(materialized.blob);
    expect(rendered).toBeDefined();
    const reopened=await JSZip.loadAsync(new Uint8Array(await rendered!.arrayBuffer()),{checkCRC32:true});
    expect(await reopened.file("word/document.xml")!.async("string")).toContain("<w:t>Evolved</w:t>");
    expect(await reopened.file("word/document.xml")!.async("string")).toContain("<w:t>Keep</w:t>");
    expect(Array.from(await reopened.file("word/media/image1.png")!.async("uint8array"))).toEqual([1,2,3,4]);
    expect(result.outputArtifacts[0]).toMatchObject({
      renderedArtifactRef:result.receipts[0]!.artifactRef,
      renderedSha256:result.receipts[0]!.sha256,
      renderedSize:rendered!.size,
    });
  });

  it("rebuilds XLSX cells and formulas from the accepted blueprint",async()=>{
    const {store,blobs}=memoryStore();
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet([[1,2],["keep",3]]);
    XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
    const rawBytes=XLSX.write(wb,{type:"array",bookType:"xlsx"});
    const raw=new Blob([rawBytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    await store.put("raw-xlsx",raw);
    const src=source({id:"source-xlsx",name:"book.xlsx",mimeType:raw.type,extension:"xlsx",artifactKind:"spreadsheet",storageRef:"raw-xlsx"});
    const snapshot={
      id:"snap-xlsx",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,
      content:JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"A1",value:10,type:"n"},{address:"B1",formula:"A1*2",type:"n"}]}]}),
      contentHash:"hash-xlsx",buildMode:"ai-full" as const,notes:[],createdAt:"now",
    };
    const {mission,output}=missionFor(src,snapshot);
    const materialized=await renderSnapshot(src,snapshot,store);
    await verifyRendered(src,snapshot,materialized.blob,store);
    const frozen=await freezeAccepted(mission,materialized.blob,store);
    const blobCount=blobs.size;
    const result=await renderAcceptedProjectArtifacts(mission,[output],store);
    expect(result.receipts[0]?.artifactRef).toBe(frozen.blobId);
    expect(blobs.size).toBe(blobCount);
    const rendered=blobs.get(result.receipts[0]!.artifactRef)!;
    expect(rendered).toBe(materialized.blob);
    const reopened=XLSX.read(await rendered.arrayBuffer(),{type:"array",cellFormula:true});
    expect(reopened.Sheets.Sheet1?.A1?.v).toBe(10);
    expect(reopened.Sheets.Sheet1?.B1?.f).toBe("A1*2");
    expect(reopened.Sheets.Sheet1?.A2?.v).toBe("keep");
  });

  it("delivers an accepted external PDF from its exact frozen bytes",async()=>{
    const {store,blobs}=memoryStore();
    const src=source({id:"source-pdf",name:"fixed.pdf",mimeType:"application/pdf",extension:"pdf",artifactKind:"document",storageRef:"raw-pdf"});
    const snapshot={
      id:"snap-pdf",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"PDF blueprint is not deliverable bytes",
      contentHash:"hash-pdf",buildMode:"ai-full" as const,notes:[],createdAt:"now",
    };
    const {mission,output}=missionFor(src,snapshot);
    const acceptedBytes=new Blob(["%PDF-1.7 accepted bytes"],{type:"application/pdf"});
    const frozen=await freezeAccepted(mission,acceptedBytes,store);
    const blobCount=blobs.size;
    const result=await renderAcceptedProjectArtifacts(mission,[output],store);
    expect(result.receipts[0]).toMatchObject({artifactRef:frozen.blobId,sha256:frozen.sha256,size:frozen.size});
    expect(result.outputArtifacts[0]?.renderedArtifactRef).toBe(frozen.blobId);
    expect(blobs.get(frozen.blobId)).toBe(acceptedBytes);
    expect(blobs.size).toBe(blobCount);
  });
  it("refuses a missing Gate F frozen Blob instead of rematerializing content",async()=>{
    const {store,blobs}=memoryStore();
    const src=source({id:"source-txt",name:"note.txt",mimeType:"text/plain",extension:"txt",artifactKind:"document",storageRef:"raw-txt"});
    const snapshot={id:"snap-txt",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"accepted",
      contentHash:"hash-txt",buildMode:"ai-full" as const,notes:[],createdAt:"now"};
    const {mission,output}=missionFor(src,snapshot);
    await expect(renderAcceptedProjectArtifacts(mission,[output],store)).rejects.toThrow("找不到 Gate F 冻结 Artifact Blob");
    expect(blobs.size).toBe(0);
  });

  it("refuses changed frozen bytes of the same size",async()=>{
    const {store,blobs}=memoryStore();
    const src=source({id:"source-txt",name:"note.txt",mimeType:"text/plain",extension:"txt",artifactKind:"document",storageRef:"raw-txt"});
    const snapshot={id:"snap-txt",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"good",
      contentHash:"hash-txt",buildMode:"ai-full" as const,notes:[],createdAt:"now"};
    const {mission,output}=missionFor(src,snapshot);
    const frozen=await freezeAccepted(mission,new Blob(["good"],{type:"text/plain"}),store);
    await store.put(frozen.blobId,new Blob(["evil"],{type:"text/plain"}));
    await expect(renderAcceptedProjectArtifacts(mission,[output],store)).rejects.toThrow("SHA-256");
    expect(blobs.size).toBe(1);
  });

  it("rejects a stale Output frozen receipt even when the accepted Blob exists",async()=>{
    const {store}=memoryStore();
    const src=source({id:"source-txt",name:"note.txt",mimeType:"text/plain",extension:"txt",artifactKind:"document",storageRef:"raw-txt"});
    const snapshot={id:"snap-txt",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"good",
      contentHash:"hash-txt",buildMode:"ai-full" as const,notes:[],createdAt:"now"};
    const {mission,output}=missionFor(src,snapshot);
    const frozen=await freezeAccepted(mission,new Blob(["good"],{type:"text/plain"}),store);
    output.frozenArtifact={...frozen,blobId:"stale-blob"};
    await expect(renderAcceptedProjectArtifacts(mission,[output],store)).rejects.toThrow("冻结引用与 Gate F 不一致");
  });

  it("requires a complete primary Output set",async()=>{
    const {store}=memoryStore();
    const src=source({id:"source-txt",name:"note.txt",mimeType:"text/plain",extension:"txt",artifactKind:"document",storageRef:"raw-txt"});
    const snapshot={id:"snap-txt",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"good",
      contentHash:"hash-txt",buildMode:"ai-full" as const,notes:[],createdAt:"now"};
    const {mission}=missionFor(src,snapshot);
    await expect(renderAcceptedProjectArtifacts(mission,[],store)).rejects.toThrow("完整覆盖");
  });
  it("refuses a Candidate snapshot that drifted from the Gate F frozen hash",async()=>{
    const {store,blobs}=memoryStore();
    const src=source({id:"source-txt",name:"note.txt",mimeType:"text/plain",extension:"txt",artifactKind:"document",storageRef:"raw-txt"});
    await store.put("raw-txt",new Blob(["old"],{type:"text/plain"}));
    const snapshot={
      id:"snap-txt",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"new",
      contentHash:"hash-new",buildMode:"ai-full" as const,notes:[],createdAt:"now",
    };
    const {mission,output}=missionFor(src,snapshot);
    mission.searchChampion!.artifactAcceptance!.frozenArtifacts![0]!.snapshotHash="hash-old";
    const before=blobs.size;
    await expect(renderAcceptedProjectArtifacts(mission,[output],store)).rejects.toThrow(/frozen hash/i);
    expect(blobs.size).toBe(before);
  });
});
