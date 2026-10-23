// @vitest-environment node
import {createHash} from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema} from "@evolution/contracts";
import {evidenceFingerprint,materializeAcceptedChampionPackage} from "@evolution/core";
import {runServerArtifactAcceptance} from "@evolution/harness";
import {acceptedAt,acceptedPackageFixture} from "@evolution/testkit";
import {materializeServerCandidateArtifacts} from "./server-experiment-artifacts";
import {buildServerCandidateTargetContext} from "./server-candidate-context";
import {parseServerSource} from "./server-source-parser";
import {verifyServerFrozenCandidateArtifacts} from "./server-artifact-acceptance";
import {renderAcceptedProjectArtifacts} from "./server-artifact-renderer";
import {prepareServerHttpReleaseArtifacts} from "./server-http-release-artifacts";

const storage=vi.hoisted(()=>new Map<string,Blob>());
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({
  get:async(id:string)=>storage.get(id),
  put:async(id:string,blob:Blob)=>{storage.set(id,blob);},
  delete:async(id:string)=>{storage.delete(id);},
})}));
const digest=async(blob:Blob)=>createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
const buf=async(blob:Blob)=>Buffer.from(await blob.arrayBuffer());

async function mission(){
  const fixture=acceptedPackageFixture(false);
  const p=fixture.project;
  const docxZip=new JSZip();
  docxZip.file("word/document.xml",'<w:document><w:t>Initial</w:t></w:document>');
  docxZip.file("word/media/photo.png",new Uint8Array([7,0,12,255]));
  const docx=new Blob([await docxZip.generateAsync({type:"arraybuffer"})],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
  const book=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Code","Value"],["000123",5],["000124",9]]),"Sales");
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Locked"],["preserve"]]),"Notes");
  const xlsx=new Blob([XLSX.write(book,{type:"array",bookType:"xlsx"})],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const csv=new Blob(["code,value\r\n000123,5\r\n000124,9\r\n"],{type:"text/csv"});
  const items=[
    {id:"docx",name:"document.docx",extension:"docx",mimeType:docx.type,artifactKind:"document" as const,blob:docx},
    {id:"xlsx",name:"table.xlsx",extension:"xlsx",mimeType:xlsx.type,artifactKind:"spreadsheet" as const,blob:xlsx},
    {id:"csv",name:"raw.csv",extension:"csv",mimeType:csv.type,artifactKind:"spreadsheet" as const,blob:csv},
  ];
  p.sourceArtifacts=await Promise.all(items.map(item=>parseServerSource({
    artifactId:item.id,name:item.name,mimeType:item.mimeType,size:item.blob.size,
    role:"target",blob:item.blob,storageRef:"original-"+item.id,
  })));
  for(const item of items)storage.set("original-"+item.id,item.blob);
  p.searchChampion=undefined;
  p.acceptanceRubric=[{
    id:"CONTENT",title:"Native artifact change",requirement:"one change and preserve siblings",
    source:"user-command",weight:100,hardGate:true,judgeType:"llm",
    validationMethod:"semantic-judge",minScore:80,evidenceExpected:["actual file bytes"],
    protectedConstraint:false,artifactIds:items.map(item=>item.id),category:"outcome",
  }];
  p.hiddenEvalSuite=p.hiddenEvalSuite.map(test=>({...test,criterionIds:["CONTENT"]}));
  const planned=CandidateSchema.parse({id:"native-candidate-1",name:"Native Candidate",change:"change DOCX/XLSX while preserving CSV"});
  const indexed=await buildServerCandidateTargetContext(p,planned,
    async source=>(await storage.get("original-"+source.id)!).text());
  expect(indexed.find(item=>item.id==="docx")?.structuredContext).toMatchObject({kind:"document",parts:[{path:"word/document.xml"}]});
  const workbookIndex=indexed.find(item=>item.id==="xlsx")?.structuredContext as {kind:string;sheets:Array<{name:string}>};
  expect(workbookIndex.kind).toBe("spreadsheet");
  expect(workbookIndex.sheets.map(sheet=>sheet.name)).toEqual(["Sales","Notes"]);
  expect(indexed.find(item=>item.id==="csv")?.structuredContext).toMatchObject({kind:"spreadsheet",sheets:[{name:"Sheet1"}]});
  const candidate=await materializeServerCandidateArtifacts(p,planned,[
    {sourceArtifactId:"docx",name:"document.docx",mimeType:docx.type,
      content:JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Improved"}]}]})},
    {sourceArtifactId:"xlsx",name:"table.xlsx",mimeType:xlsx.type,
      content:JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sales",cells:[{address:"B2",value:15}]}]})},
    {sourceArtifactId:"csv",name:"raw.csv",mimeType:csv.type,
      content:JSON.stringify({kind:"keep-parent",sourceArtifactId:"csv"})},
  ],"Synthetic native byte mutations only");
  p.candidates=[candidate];
  p.selectedCandidateIds=[candidate.id];
  p.experimentRun={...p.experimentRun,status:"completed",winnerId:candidate.id};
  p.validationRun={
    ...p.validationRun,status:"completed",candidateId:candidate.id,
    recommendation:"release",validationMode:"full",
    evaluation:{...p.validationRun.evaluation!,criterionScores:[{
      criterionId:"CONTENT",score:95,pass:true,verificationStatus:"verified",
      testCaseIds:["H1"],evidence:["synthetic suite receipt"],gaps:[],
    }],rubricScore:95,verifiedRubricCoverage:100,unverifiedCriterionIds:[]},
  };
  p.validationRun.evidenceFingerprint=evidenceFingerprint(p,candidate);
  p.artifactAcceptance={...p.artifactAcceptance,status:"idle",candidateId:undefined,frozenArtifacts:undefined,evidenceFingerprint:undefined};
  p.campaign={...p.campaign,status:"running",checkpoint:{round:1,completedPhase:"validation",at:acceptedAt}};
  return {project:p,candidate,items};
}


async function mixedCodeMission(){
  const fixture=acceptedPackageFixture(false);
  const p=fixture.project;
  const slides=new JSZip();
  slides.file("ppt/slides/slide1.xml",'<p:sld><a:t xml:space="preserve"> Old slide </a:t></p:sld>');
  slides.file("ppt/media/chart.png",new Uint8Array([17,23,0,255]));
  const pptx=new Blob([await slides.generateAsync({type:"arraybuffer"})],{
    type:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  const code=new JSZip();
  code.file("src/app.ts","export const answer = 1;");
  code.file("assets/icon.bin",new Uint8Array([13,0,255]));
  const zip=new Blob([await code.generateAsync({type:"arraybuffer"})],{type:"application/zip"});
  const html=new Blob(["<!doctype html><html><body><h1>Original</h1><footer>Protected footer</footer></body></html>"],{type:"text/html"});
  const items=[
    {id:"pptx",name:"deck.pptx",extension:"pptx",mimeType:pptx.type,artifactKind:"presentation" as const,blob:pptx},
    {id:"html",name:"index.html",extension:"html",mimeType:html.type,artifactKind:"document" as const,blob:html},
    {id:"zip",name:"repo.zip",extension:"zip",mimeType:zip.type,artifactKind:"codebase" as const,blob:zip},
  ];
  p.sourceArtifacts=await Promise.all(items.map(item=>parseServerSource({
    artifactId:item.id,name:item.name,mimeType:item.mimeType,size:item.blob.size,
    role:"target",blob:item.blob,storageRef:"original-"+item.id,
  })));
  for(const item of items)storage.set("original-"+item.id,item.blob);
  p.searchChampion=undefined;
  p.acceptanceRubric=[{
    id:"CONTENT",title:"Three native targets",requirement:"only targeted changes",
    source:"user-command",weight:100,hardGate:true,judgeType:"llm",
    validationMethod:"semantic-judge",minScore:80,evidenceExpected:["native changes"],
    protectedConstraint:false,artifactIds:items.map(item=>item.id),category:"outcome",
  }];
  p.hiddenEvalSuite=p.hiddenEvalSuite.map(test=>({...test,criterionIds:["CONTENT"]}));
  const planned=CandidateSchema.parse({id:"native-candidate-2",name:"PPTX HTML ZIP",change:"Isolated synthetic changes"});
  const indexed=await buildServerCandidateTargetContext(p,planned,
    async source=>(await storage.get("original-"+source.id)!).text());
  expect(indexed.find(item=>item.id==="pptx")?.structuredContext).toMatchObject({kind:"presentation",slides:[{number:1}]});
  expect(indexed.find(item=>item.id==="html")?.content).toContain("Protected footer");
  expect(indexed.find(item=>item.id==="zip")?.artifactKind).toBe("codebase");
  const candidate=await materializeServerCandidateArtifacts(p,planned,[
      {sourceArtifactId:"pptx",name:"deck.pptx",mimeType:pptx.type,
        content:JSON.stringify({kind:"presentation",slides:[{number:1,textRuns:[{index:0,text:" New slide "}]}]})},
      {sourceArtifactId:"html",name:"index.html",mimeType:html.type,
        content:"<!doctype html><html><body><h1>Improved</h1><footer>Protected footer</footer></body></html>"},
      {sourceArtifactId:"zip",name:"repo.zip",mimeType:zip.type,
        content:JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/app.ts",content:"export const answer = 2;"}],deletions:[]})},
    ],"Synthetic native byte edits");
  p.candidates=[candidate];
  p.selectedCandidateIds=[candidate.id];
  p.experimentRun={...p.experimentRun,status:"completed",winnerId:candidate.id};
  p.validationRun={
    ...p.validationRun,status:"completed",candidateId:candidate.id,
    recommendation:"release",validationMode:"full",
    evaluation:{...p.validationRun.evaluation!,criterionScores:[{
      criterionId:"CONTENT",score:95,pass:true,verificationStatus:"verified",
      testCaseIds:["H1"],evidence:["synthetic complete receipt"],gaps:[],
    }],rubricScore:95,verifiedRubricCoverage:100,unverifiedCriterionIds:[]},
  };
  p.validationRun.evidenceFingerprint=evidenceFingerprint(p,candidate);
  p.artifactAcceptance={...p.artifactAcceptance,status:"idle",candidateId:undefined,frozenArtifacts:undefined,evidenceFingerprint:undefined};
  p.campaign={...p.campaign,status:"running",checkpoint:{round:1,completedPhase:"validation",at:acceptedAt}};
  return{project:p,candidate,items};
}
beforeEach(()=>storage.clear());

describe("isolated native files → synthetic Hidden evidence → real Gate F settlement → exact bytes",()=>{
  it("accepts a three-target native Candidate with synthetic Hidden evidence and delivers the very same frozen bytes",async()=>{
    const {project,candidate,items}=await mission();
    const validated=await verifyServerFrozenCandidateArtifacts({project,candidate});
    expect(validated.verified).toHaveLength(3);
    expect(validated.unavailable).toEqual([]);
    expect(validated.failed).toEqual([]);
    const accepted=await runServerArtifactAcceptance(project,{
      verifyFrozenArtifacts:verifyServerFrozenCandidateArtifacts,
      repairCandidate:async()=>{throw Error("No repair expected");},
    },{now:()=>acceptedAt});
    expect(accepted.accepted).toBe(true);
    expect(accepted.project.artifactAcceptance.status).toBe("passed");
    expect(accepted.project.searchChampion?.candidate?.id).toBe(candidate.id);
    const packageMetadata=materializeAcceptedChampionPackage(accepted.project);
    expect(packageMetadata.filter(a=>a.kind==="primary")).toHaveLength(3);
    const readOnlyStore={
      get:async(id:string)=>storage.get(id),
      put:async()=>{throw Error("No post-Gate-F bytes may be rewritten");},
      delete:async()=>{throw Error("Never delete accepted bytes");},
    };
    const before=new Map(storage);
    const rendered=await renderAcceptedProjectArtifacts(accepted.project,packageMetadata,readOnlyStore);
    expect(rendered.receipts).toHaveLength(3);
    expect(storage.size).toBe(before.size);
    const released=await prepareServerHttpReleaseArtifacts(accepted.project,candidate,readOnlyStore);
    expect(released.frozenArtifacts.map(item=>item.sourceArtifactId)).toEqual(items.map(item=>item.id));
    for(const packet of released.frozenArtifacts){
      const receipt=rendered.receipts.find(item=>item.sourceArtifactId===packet.sourceArtifactId)!;
      const originalFrozen=before.get(receipt.artifactRef)!;
      expect(packet.sha256).toBe(receipt.sha256);
      expect(Buffer.from(packet.contentBase64,"base64")).toEqual(await buf(originalFrozen));
      expect(await digest(originalFrozen)).toBe(packet.sha256);
    }
    const doc=await JSZip.loadAsync(Buffer.from(released.frozenArtifacts[0]!.contentBase64,"base64"),{checkCRC32:true});
    expect(await doc.file("word/document.xml")!.async("string")).toContain("Improved");
    expect(Array.from(await doc.file("word/media/photo.png")!.async("uint8array"))).toEqual([7,0,12,255]);
    const wb=XLSX.read(Buffer.from(released.frozenArtifacts[1]!.contentBase64,"base64"),{type:"buffer",cellFormula:true});
    expect(wb.Sheets.Sales?.B2?.v).toBe(15);
    expect(wb.Sheets.Sales?.A2?.v).toBe("000123");
    expect(wb.Sheets.Notes?.A2?.v).toBe("preserve");
    expect(Buffer.from(released.frozenArtifacts[2]!.contentBase64,"base64")).toEqual(await buf(items[2]!.blob));
  });

  it("delivers exact PPTX + HTML + ZIP bytes after synthetic Gate F, preserving unrelated assets",async()=>{
    const {project,candidate}=await mixedCodeMission();
    const settled=await runServerArtifactAcceptance(project,{
      verifyFrozenArtifacts:verifyServerFrozenCandidateArtifacts,
      repairCandidate:async()=>{throw Error("unexpected repair");},
    },{now:()=>acceptedAt});
    expect(settled.accepted).toBe(true);
    expect(settled.project.artifactAcceptance.status).toBe("passed");
    const artifacts=materializeAcceptedChampionPackage(settled.project);
    expect(artifacts.filter(a=>a.kind==="primary")).toHaveLength(3);
    const noWrite={
      get:async(id:string)=>storage.get(id),
      put:async()=>{throw Error("regeneration after Gate F forbidden");},
      delete:async()=>{throw Error("deleting accepted blob forbidden");},
    };
    const count=storage.size;
    const linked=await renderAcceptedProjectArtifacts(settled.project,artifacts,noWrite);
    expect(linked.receipts).toHaveLength(3);
    expect(storage.size).toBe(count);
    const bytes=await prepareServerHttpReleaseArtifacts(settled.project,candidate,noWrite);
    expect(bytes.frozenArtifacts.map(item=>item.sourceArtifactId)).toEqual(["pptx","html","zip"]);
    for(const item of bytes.frozenArtifacts){
      const reference=linked.receipts.find(receipt=>receipt.sourceArtifactId===item.sourceArtifactId)!;
      expect(Buffer.from(item.contentBase64,"base64")).toEqual(await buf(storage.get(reference.artifactRef)!));
      expect(item.sha256).toBe(reference.sha256);
    }
    const ppt=await JSZip.loadAsync(Buffer.from(bytes.frozenArtifacts[0]!.contentBase64,"base64"),{checkCRC32:true});
    expect(await ppt.file("ppt/slides/slide1.xml")!.async("string")).toContain(" New slide ");
    expect(Array.from(await ppt.file("ppt/media/chart.png")!.async("uint8array"))).toEqual([17,23,0,255]);
    const evolvedHTML=Buffer.from(bytes.frozenArtifacts[1]!.contentBase64,"base64").toString("utf8");
    expect(evolvedHTML).toContain("<h1>Improved</h1>");
    expect(evolvedHTML).toContain("Protected footer");
    const repo=await JSZip.loadAsync(Buffer.from(bytes.frozenArtifacts[2]!.contentBase64,"base64"),{checkCRC32:true});
    expect(await repo.file("src/app.ts")!.async("string")).toBe("export const answer = 2;");
    expect(Array.from(await repo.file("assets/icon.bin")!.async("uint8array"))).toEqual([13,0,255]);
  });

  it("does not pass synthetic Gate F when independent Hidden observations are absent",async()=>{
    const {project,candidate}=await mission();
    project.validationRun={...project.validationRun,runs:[]};
    project.validationRun.evidenceFingerprint=evidenceFingerprint(project,candidate);
    const outcome=await runServerArtifactAcceptance(project,{
      verifyFrozenArtifacts:verifyServerFrozenCandidateArtifacts,
      repairCandidate:async()=>{throw Error("unverified Hidden must not repair");},
    },{now:()=>acceptedAt});
    expect(outcome.accepted).toBe(false);
    expect(outcome.project.artifactAcceptance.status).not.toBe("passed");
    expect(outcome.project.searchChampion?.candidate).toBeUndefined();
    expect(()=>materializeAcceptedChampionPackage(outcome.project)).toThrow(/Search Champion/);
  });

  it("blocks Gate F after tampering with one stored native file of unchanged size",async()=>{
    const {project,candidate}=await mission();
    const receipt=candidate.artifactSnapshots.find(item=>item.sourceArtifactId==="xlsx")!.frozenArtifact!;
    const good=storage.get(receipt.blobId)!;
    const corrupted=new Uint8Array(await good.arrayBuffer());
    corrupted[corrupted.length-3]^=1;
    storage.set(receipt.blobId,new Blob([corrupted.buffer],{type:good.type}));
    const output=await runServerArtifactAcceptance(project,{
      verifyFrozenArtifacts:verifyServerFrozenCandidateArtifacts,
      repairCandidate:async()=>{throw Error("No repair after broken identity");},
    },{now:()=>acceptedAt});
    expect(output.accepted).toBe(false);
    expect(output.project.artifactAcceptance.status).toBe("failed");
    expect(output.project.campaign.status).toBe("paused");
    expect(output.reason).toContain("integrity-failed");
  });
});