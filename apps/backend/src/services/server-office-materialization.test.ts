// @vitest-environment node
import {createHash} from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,type EvolveProject,type SourceArtifact} from "@evolution/contracts";
import {materializeServerCandidateArtifacts,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";

const {getBlob,putBlob,blobs}=vi.hoisted(()=>({
  getBlob:vi.fn(),putBlob:vi.fn(),blobs:new Map<string,Blob>(),
}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:getBlob,put:putBlob})}));

function source(id:string,name:string,extension:string,adapterId:string,family:string):SourceArtifact{
  return{
    id,name,role:"target",artifactKind:family==="spreadsheet"?"spreadsheet":family==="presentation"?"presentation":"document",
    mimeType:extension==="docx"?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      extension==="pptx"?"application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size:0,extension,inputMode:"upload",parseStatus:"ready",storageRef:"raw-"+extension,
    structure:[],warnings:[],createdAt:"2026-09-27T00:00:00Z",
    artifactDescriptor:{family,adapterId,preservationMode:"same-package",capabilities:{materialize:true}},
  } as unknown as SourceArtifact;
}

function candidate(id:string){
  return CandidateSchema.parse({id,name:id,change:"Update accepted document content"});
}

async function build(project:EvolveProject,content:string,id="candidate"){
  const target=project.sourceArtifacts[0]!;
  return materializeServerCandidateArtifacts(project,candidate(id),[{
    sourceArtifactId:target.id,name:target.name,mimeType:target.mimeType,content,
  }],"office materialized");
}

beforeEach(()=>{
  blobs.clear();
  getBlob.mockReset().mockImplementation(async(id:string)=>blobs.get(id));
  putBlob.mockReset().mockImplementation(async(id:string,blob:Blob)=>{blobs.set(id,blob);});
});

describe("server Office candidate materialization before Gate F",()=>{
  it("freezes a DOCX with changed runs and preserved media",async()=>{
    const src=source("docx-source","report.docx","docx","document-docx-ooxml","text");
    const zip=new JSZip();
    zip.file("word/document.xml",'<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t>Keep</w:t></w:r></w:p></w:body></w:document>');
    zip.file("word/media/image1.png",new Uint8Array([1,2,3]));
    blobs.set("raw-docx",new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:src.mimeType}));
    const project={id:"mission-docx",sourceArtifacts:[src]} as unknown as EvolveProject;
    const result=await build(project,JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Evolved"}]}]}));
    const frozen=result.artifactSnapshots[0]!.frozenArtifact!;
    const stored=blobs.get(frozen.blobId)!;
    expect(frozen.size).toBe(stored.size);
    expect(frozen.sha256).toBe(createHash("sha256").update(new Uint8Array(await stored.arrayBuffer())).digest("hex"));
    const reopened=await JSZip.loadAsync(new Uint8Array(await stored.arrayBuffer()),{checkCRC32:true});
    expect(await reopened.file("word/document.xml")!.async("string")).toContain("<w:t>Evolved</w:t>");
    expect(await reopened.file("word/document.xml")!.async("string")).toContain("<w:t>Keep</w:t>");
    expect(Array.from(await reopened.file("word/media/image1.png")!.async("uint8array"))).toEqual([1,2,3]);
    expect(getBlob).toHaveBeenCalledWith("raw-docx");
  });

  it("uses the accepted Champion DOCX as the next round parent",async()=>{
    const src=source("docx-source","report.docx","docx","document-docx-ooxml","text");
    const raw=new JSZip();
    raw.file("word/document.xml",'<w:document><w:body><w:t>Original</w:t></w:body></w:document>');
    blobs.set("raw-docx",new Blob([await raw.generateAsync({type:"arraybuffer"})],{type:src.mimeType}));
    const accepted=new JSZip();
    accepted.file("word/document.xml",'<w:document><w:body><w:t>Champion</w:t></w:body></w:document>');
    accepted.file("word/media/champion.png",new Uint8Array([7,8,9]));
    const acceptedBlob=new Blob([await accepted.generateAsync({type:"arraybuffer"})],{type:src.mimeType});
    blobs.set("champion-blob",acceptedBlob);
    const frozen={
      sourceArtifactId:src.id,snapshotHash:"champion-hash",blobId:"champion-blob",name:src.name,mimeType:src.mimeType,
      sha256:createHash("sha256").update(new Uint8Array(await acceptedBlob.arrayBuffer())).digest("hex"),
      size:acceptedBlob.size,verifiedAt:"2026-09-27T00:00:00Z",checks:["zip"],limitations:[],
    };
    const championCandidate=candidate("champion");
    championCandidate.artifactSnapshots=[{
      id:"champion-snapshot",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,content:"champion",
      contentHash:"champion-hash",buildMode:"ai-full",notes:[],createdAt:"2026-09-27T00:00:00Z",frozenArtifact:frozen,
    }];
    const project={
      id:"mission-docx",sourceArtifacts:[src],
      searchChampion:{versionLabel:"C1",candidate:championCandidate,
        validation:{status:"completed",recommendation:"release"},
        artifactAcceptance:{status:"passed",candidateId:"champion"}},
    } as unknown as EvolveProject;
    const result=await build(project,JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Round two"}]}]}),"next");
    const stored=blobs.get(result.artifactSnapshots[0]!.frozenArtifact!.blobId)!;
    const reopened=await JSZip.loadAsync(new Uint8Array(await stored.arrayBuffer()),{checkCRC32:true});
    expect(await reopened.file("word/document.xml")!.async("string")).toContain("<w:t>Round two</w:t>");
    expect(Array.from(await reopened.file("word/media/champion.png")!.async("uint8array"))).toEqual([7,8,9]);
    expect(getBlob).toHaveBeenCalledWith("champion-blob");
  });

  it("freezes a PPTX after rewriting slide text without dropping assets",async()=>{
    const src=source("pptx-source","deck.pptx","pptx","presentation-pptx-ooxml","presentation");
    const zip=new JSZip();
    zip.file("ppt/slides/slide1.xml",'<p:sld><a:t>Original</a:t></p:sld>');
    zip.file("ppt/media/image1.png",new Uint8Array([4,5,6]));
    blobs.set("raw-pptx",new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:src.mimeType}));
    const project={id:"mission-pptx",sourceArtifacts:[src]} as unknown as EvolveProject;
    const result=await build(project,JSON.stringify({kind:"presentation",slides:[{number:1,textRuns:[{index:0,text:"Revised"}]}]}));
    const stored=blobs.get(result.artifactSnapshots[0]!.frozenArtifact!.blobId)!;
    const reopened=await JSZip.loadAsync(new Uint8Array(await stored.arrayBuffer()),{checkCRC32:true});
    expect(await reopened.file("ppt/slides/slide1.xml")!.async("string")).toContain("<a:t>Revised</a:t>");
    expect(Array.from(await reopened.file("ppt/media/image1.png")!.async("uint8array"))).toEqual([4,5,6]);
  });

  it("freezes an XLSX with updated cells and retained untouched rows",async()=>{
    const src=source("xlsx-source","book.xlsx","xlsx","spreadsheet-xlsx","spreadsheet");
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([[1,2],["keep",3]]),"Sheet1");
    blobs.set("raw-xlsx",new Blob([XLSX.write(workbook,{type:"array",bookType:"xlsx"})],{type:src.mimeType}));
    const project={id:"mission-xlsx",sourceArtifacts:[src]} as unknown as EvolveProject;
    const result=await build(project,JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[
      {address:"A1",value:10,type:"n"},{address:"B1",formula:"A1*2",type:"n"},
    ]}]}));
    const stored=blobs.get(result.artifactSnapshots[0]!.frozenArtifact!.blobId)!;
    const reopened=XLSX.read(await stored.arrayBuffer(),{type:"array",cellFormula:true});
    expect(reopened.Sheets.Sheet1?.A1?.v).toBe(10);
    expect(reopened.Sheets.Sheet1?.B1?.f).toBe("A1*2");
    expect(reopened.Sheets.Sheet1?.A2?.v).toBe("keep");
  });

  it("preserves an unchanged XLSX by frozen original bytes in a mixed DOCX+XLSX Mission, then inherits it",async()=>{
    const doc=source("docx-source","report.docx","docx","document-docx-ooxml","text");
    const sheet=source("xlsx-source","book.xlsx","xlsx","spreadsheet-xlsx","spreadsheet");
    const docZip=new JSZip();
    docZip.file("word/document.xml",'<w:document><w:t>Original</w:t></w:document>');
    docZip.file("word/media/keep.png",new Uint8Array([7,5,3]));
    const docRaw=new Blob([await docZip.generateAsync({type:"arraybuffer"})],{type:doc.mimeType});
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[1,2],["untouched",3]]),"Sheet1");
    const xlsxRaw=new Blob([XLSX.write(wb,{type:"array",bookType:"xlsx"})],{type:sheet.mimeType});
    blobs.set("raw-docx",docRaw);blobs.set("raw-xlsx",xlsxRaw);
    const project={id:"mission-mixed",sourceArtifacts:[doc,sheet]} as unknown as EvolveProject;
    const first=await materializeServerCandidateArtifacts(project,candidate("mixed-first"),[
      {sourceArtifactId:doc.id,name:doc.name,mimeType:doc.mimeType,
        content:JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Updated"}]}]})},
      {sourceArtifactId:sheet.id,name:sheet.name,mimeType:sheet.mimeType,
        content:JSON.stringify({kind:"keep-parent",sourceArtifactId:sheet.id})},
    ],"Only DOCX changed");
    expect(first.artifactSnapshots).toHaveLength(2);
    const firstDoc=first.artifactSnapshots.find(s=>s.sourceArtifactId===doc.id)!;
    const unchangedSheet=first.artifactSnapshots.find(s=>s.sourceArtifactId===sheet.id)!;
    expect(unchangedSheet.frozenArtifact?.sha256).toBe(createHash("sha256")
      .update(new Uint8Array(await xlsxRaw.arrayBuffer())).digest("hex"));
    expect(Buffer.compare(Buffer.from(await blobs.get(unchangedSheet.frozenArtifact!.blobId)!.arrayBuffer()),
      Buffer.from(await xlsxRaw.arrayBuffer()))).toBe(0);
    const secondProject={...project,searchChampion:{versionLabel:"C1",candidate:first,
      validation:{status:"completed",recommendation:"release"},
      artifactAcceptance:{status:"passed",candidateId:first.id}}} as unknown as EvolveProject;
    const second=await materializeServerCandidateArtifacts(secondProject,candidate("mixed-next"),[
      {sourceArtifactId:doc.id,name:doc.name,mimeType:doc.mimeType,
        content:JSON.stringify({kind:"keep-parent",sourceArtifactId:doc.id})},
      {sourceArtifactId:sheet.id,name:sheet.name,mimeType:sheet.mimeType,
        content:JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"A1",value:10}]}]})},
    ],"Only spreadsheet changed in round 2");
    const laterDoc=second.artifactSnapshots.find(s=>s.sourceArtifactId===doc.id)!;
    expect(laterDoc.frozenArtifact?.sha256).toBe(firstDoc.frozenArtifact?.sha256);
    expect(laterDoc.frozenArtifact?.blobId).toBe(firstDoc.frozenArtifact?.blobId);
    const laterSheet=second.artifactSnapshots.find(s=>s.sourceArtifactId===sheet.id)!;
    const reopened=XLSX.read(await blobs.get(laterSheet.frozenArtifact!.blobId)!.arrayBuffer(),
      {type:"array",cellFormula:true});
    expect(reopened.Sheets.Sheet1?.A1?.v).toBe(10);
    expect(reopened.Sheets.Sheet1?.A2?.v).toBe("untouched");
  });

  it("freezes and verifies native CSV/TSV bytes, not their sparse JSON edit instruction",async()=>{
    for(const ext of ["csv","tsv"]){
      const csv=source("table-"+ext,"data."+ext,ext,"spreadsheet-generic","spreadsheet");
      csv.mimeType=ext==="csv"?"text/csv":"text/tab-separated-values";
      const original=ext==="csv"?"code,value\n000123,5\n000124,9\n":"code\tvalue\n000123\t5\n000124\t9\n";
      blobs.set("raw-"+ext,new Blob([original],{type:csv.mimeType}));
      const project={id:"test-"+ext,sourceArtifacts:[csv]} as unknown as EvolveProject;
      const first=await build(project,JSON.stringify({kind:"spreadsheet",sheets:[{
        name:"Sheet1",cells:[{address:"B2",value:15}],
      }]}),"candidate-"+ext);
      const snapshot=first.artifactSnapshots[0]!;
      expect(snapshot.frozenArtifact?.sha256).toHaveLength(64);
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(true);
      const stored=blobs.get(snapshot.frozenArtifact!.blobId)!;
      const materialized=await stored.text();
      expect(materialized).toContain("000124");
      expect(materialized).toContain("15");
      const wrong=new Blob([materialized.replace("15","99")],{type:csv.mimeType});
      blobs.set(snapshot.frozenArtifact!.blobId,wrong);
      expect(await verifyServerCandidateFrozenArtifact(snapshot)).toBe(false);
      blobs.set(snapshot.frozenArtifact!.blobId,stored);
    }
  });

  it("keeps CSV exactly intact in round one, then edits the same frozen CSV in round two",async()=>{
    const doc=source("docx-source","notes.docx","docx","document-docx-ooxml","text");
    const csv=source("csv-source","records.csv","csv","spreadsheet-generic","spreadsheet");
    csv.mimeType="text/csv";
    const zip=new JSZip();zip.file("word/document.xml",'<w:document><w:t>Original</w:t></w:document>');
    blobs.set("raw-docx",new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:doc.mimeType}));
    const csvOriginal=new Blob(["key,value\n001,5\n002,9\n"],{type:csv.mimeType});
    blobs.set("raw-csv",csvOriginal);
    const project={id:"mission-csv-two-rounds",sourceArtifacts:[doc,csv]} as unknown as EvolveProject;
    const first=await materializeServerCandidateArtifacts(project,candidate("csv-first"),[
      {sourceArtifactId:doc.id,name:doc.name,mimeType:doc.mimeType,
        content:JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Edited"}]}]})},
      {sourceArtifactId:csv.id,name:csv.name,mimeType:csv.mimeType,
        content:JSON.stringify({kind:"keep-parent",sourceArtifactId:csv.id})},
    ],"DOCX changed");
    const firstCsv=first.artifactSnapshots.find(s=>s.sourceArtifactId===csv.id)!;
    expect(await verifyServerCandidateFrozenArtifact(firstCsv)).toBe(true);
    expect(await blobs.get(firstCsv.frozenArtifact!.blobId)!.text()).toBe(await csvOriginal.text());
    const secondProject={...project,searchChampion:{versionLabel:"C1",candidate:first,
      validation:{status:"completed",recommendation:"release"},
      artifactAcceptance:{status:"passed",candidateId:first.id}}} as unknown as EvolveProject;
    const second=await materializeServerCandidateArtifacts(secondProject,candidate("csv-second"),[
      {sourceArtifactId:doc.id,name:doc.name,mimeType:doc.mimeType,
        content:JSON.stringify({kind:"keep-parent",sourceArtifactId:doc.id})},
      {sourceArtifactId:csv.id,name:csv.name,mimeType:csv.mimeType,
        content:JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"B2",value:25}]}]})},
    ],"CSV changed");
    const laterCsv=second.artifactSnapshots.find(s=>s.sourceArtifactId===csv.id)!;
    expect(await verifyServerCandidateFrozenArtifact(laterCsv)).toBe(true);
    const body=await blobs.get(laterCsv.frozenArtifact!.blobId)!.text();
    expect(body).toContain("001,25");
    expect(body).toContain("002,9");
  });

  it("fails closed for all keep-parent targets or an unbound preservation request",async()=>{
    const doc=source("docx-source","report.docx","docx","document-docx-ooxml","text");
    const zip=new JSZip();zip.file("word/document.xml",'<w:document><w:t>Original</w:t></w:document>');
    blobs.set("raw-docx",new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:doc.mimeType}));
    const project={id:"mission-preserve",sourceArtifacts:[doc]} as unknown as EvolveProject;
    const keep=(id:string)=>[{sourceArtifactId:doc.id,name:doc.name,mimeType:doc.mimeType,
      content:JSON.stringify({kind:"keep-parent",sourceArtifactId:id})}];
    await expect(materializeServerCandidateArtifacts(project,candidate("noop"),keep(doc.id),"no changes"))
      .rejects.toThrow(/完全相同/);
    await expect(materializeServerCandidateArtifacts(project,candidate("forged"),keep("wrong-source"),"mismatch"))
      .rejects.toThrow(/Source ID/);
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("renders legacy DOCX/PPTX artifacts with no saved V2 descriptor using original OOXML bytes",async()=>{
    for(const extension of ["docx","pptx"] as const){
      const descriptor=extension==="docx"?"document-docx-ooxml":"presentation-pptx-ooxml";
      const src=source(extension+"-legacy","legacy."+extension,extension,descriptor,
        extension==="docx"?"text":"presentation");
      src.artifactDescriptor=undefined; // Older uploaded Missions predate the capability descriptor.
      const zip=new JSZip();
      const path=extension==="docx"?"word/document.xml":"ppt/slides/slide1.xml";
      zip.file(path,extension==="docx"?'<w:document><w:t>Original</w:t></w:document>':'<p:sld><a:t>Original</a:t></p:sld>');
      zip.file("media/untouched.png",new Uint8Array([1,8,6]));
      blobs.set("raw-"+extension,new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:src.mimeType}));
      const blueprint=extension==="docx"
        ?{kind:"document",parts:[{path,textRuns:[{index:0,text:"Round 1"}]}]}
        :{kind:"presentation",slides:[{number:1,textRuns:[{index:0,text:"Round 1"}]}]};
      const project={id:"legacy-"+extension,sourceArtifacts:[src]} as unknown as EvolveProject;
      const result=await build(project,JSON.stringify(blueprint),"legacy-native-"+extension);
      const frozen=result.artifactSnapshots[0]!.frozenArtifact!;
      const reopened=await JSZip.loadAsync(new Uint8Array(await blobs.get(frozen.blobId)!.arrayBuffer()),{checkCRC32:true});
      expect(await reopened.file(path)!.async("string")).toContain("Round 1");
      expect(Array.from(await reopened.file("media/untouched.png")!.async("uint8array"))).toEqual([1,8,6]);
    }
  });

  it("refuses a missing referenced DOCX base without persisting a Candidate",async()=>{
    const src=source("docx-source","report.docx","docx","document-docx-ooxml","text");
    const project={id:"mission-docx",sourceArtifacts:[src]} as unknown as EvolveProject;
    await expect(build(project,JSON.stringify({kind:"document",parts:[]}))).rejects.toThrow(/父代|原始 package|Blob/);
    expect(putBlob).not.toHaveBeenCalled();
  });
});