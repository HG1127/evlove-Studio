// @vitest-environment node
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {describe,expect,it} from "vitest";
import type {ArtifactStorePort,Candidate,EvolveProject,OutputArtifact,SourceArtifact} from "@evolution/contracts";
import {renderAcceptedProjectArtifacts} from "./server-artifact-renderer";

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
    const result=await renderAcceptedProjectArtifacts(mission,[output],store);
    expect(result.receipts).toHaveLength(1);
    const rendered=blobs.get(result.receipts[0]!.artifactRef);
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
    const result=await renderAcceptedProjectArtifacts(mission,[output],store);
    const rendered=blobs.get(result.receipts[0]!.artifactRef)!;
    const reopened=XLSX.read(await rendered.arrayBuffer(),{type:"array",cellFormula:true});
    expect(reopened.Sheets.Sheet1?.A1?.v).toBe(10);
    expect(reopened.Sheets.Sheet1?.B1?.f).toBe("A1*2");
    expect(reopened.Sheets.Sheet1?.A2?.v).toBe("keep");
  });

  it("refuses external-required PDF instead of generating a fake PDF",async()=>{
    const {store}=memoryStore();
    const src=source({id:"source-pdf",name:"fixed.pdf",mimeType:"application/pdf",extension:"pdf",artifactKind:"document",storageRef:"raw-pdf"});
    await store.put("raw-pdf",new Blob(["%PDF"],{type:"application/pdf"}));
    const snapshot={
      id:"snap-pdf",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"fake pdf text",
      contentHash:"hash-pdf",buildMode:"ai-full" as const,notes:[],createdAt:"now",
    };
    const {mission,output}=missionFor(src,snapshot);
    await expect(renderAcceptedProjectArtifacts(mission,[output],store)).rejects.toThrow(/外部|external|required|Renderer/i);
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
