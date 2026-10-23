// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,expect,it,vi} from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {CandidateSchema,TestCaseSchema,type SourceArtifact} from "@evolution/contracts";
import {materializeAcceptedChampionPackage,finalHoldoutPaperHash,finalHoldoutContractFingerprint} from "@evolution/core";
import {runServerHoldout,runServerArtifactAcceptance,type ServerHoldoutPorts} from "@evolution/harness";
import {acceptedPackageFixture} from "@evolution/testkit";
import {parseServerSource} from "./server-source-parser";
import {materializeServerCandidateArtifacts,verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {verifyServerCandidateNativeFormats} from "./server-candidate-native-roundtrip";
import {runServerCurrentStoredEvidence} from "./server-current-stored-evidence";
import {readServerHoldoutArtifactFingerprint} from "./server-holdout-artifact-binding";
import {verifyServerFrozenCandidateArtifacts} from "./server-artifact-acceptance";
import {renderAcceptedProjectArtifacts} from "./server-artifact-renderer";
import {verifyServerIndependentFinalHoldout} from "./server-independent-final-holdout";

const blobs=vi.hoisted(()=>new Map<string,Blob>());
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({get:async(id:string)=>blobs.get(id),
  put:async(id:string,blob:Blob)=>{blobs.set(id,blob);}})}));
beforeEach(()=>blobs.clear());
const sha=async(blob:Blob)=>createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");
async function files(){
  const items:Array<{ext:string;blob:Blob;patch:string}>=[];
  for(const ext of ["docx","pptx"]){
    const zip=new JSZip();
    zip.file("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file("_rels/.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    if(ext==="docx")zip.file("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Original</w:t></w:r></w:p></w:body></w:document>');
    else{
      zip.file("ppt/presentation.xml",'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:presentation>');
      zip.file("ppt/slides/slide1.xml",'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Original</a:t></p:sld>');
    }
    zip.file("assets/protected.bin",new Uint8Array([1,0,255]));
    const patch=ext==="docx"?{kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Updated"}]}]}
      :{kind:"presentation",slides:[{number:1,textRuns:[{index:0,text:"Updated"}]}]};
    items.push({ext,blob:new Blob([await zip.generateAsync({type:"arraybuffer"})]),patch:JSON.stringify(patch)});
  }
  for(const ext of ["xlsx","xls","ods"] as const){
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Code","Value"],["000123",5]]),"Data");
    items.push({ext,blob:new Blob([XLSX.write(book,{type:"array",bookType:ext})]),
      patch:JSON.stringify({kind:"spreadsheet",sheets:[{name:"Data",cells:[{address:"B2",value:15}]}]})});
  }
  items.push({ext:"csv",blob:new Blob(["code,value\n000123,5\n"],{type:"text/csv"}),
    patch:JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"B2",value:15}]}]})});
  const zip=new JSZip();zip.file("src/app.ts","export const answer = 1;");zip.file("assets/protected.bin",new Uint8Array([1,0,255]));
  items.push({ext:"zip",blob:new Blob([await zip.generateAsync({type:"arraybuffer"})],{type:"application/zip"}),
    patch:JSON.stringify({kind:"codebase",overlay:true,files:[{path:"src/app.ts",content:"export const answer = 2;"}],deletions:[]})});
  for(const [ext,before,patch] of [
    ["html","<html><body>Original</body></html>","<html><body>Updated</body></html>"],
    ["jsonl",'{"value":1}\n','{"value":2}\n'],["yaml","value: 1\n","value: 2\n"],
    ["xml","<value>1</value>","<value>2</value>"],["ts","export const value = 1;","export const value = 2;"],
  ])items.push({ext:ext!,blob:new Blob([before!],{type:"text/plain"}),patch:patch!});
  return items;
}

it("executes twelve-format paired Hidden format checks before Gate F and exact-byte delivery",async()=>{
  // This is a deterministic format-only contract. No AI quality, Office visual or runtime claim is made.
  const p=acceptedPackageFixture(false).project;
  const items=await files();const sources:SourceArtifact[]=[];
  for(const item of items){
    const source=await parseServerSource({artifactId:item.ext,name:"input."+item.ext,mimeType:item.blob.type||"application/octet-stream",
      size:item.blob.size,role:"target",blob:item.blob,storageRef:"raw-"+item.ext});
    expect(source.parseStatus,source.warnings.join(";")).toBe("ready");sources.push(source);blobs.set("raw-"+item.ext,item.blob);
  }
  p.sourceArtifacts=sources;p.searchChampion=undefined;
  p.acceptanceRubric=sources.map(source=>({id:"FMT-"+source.id,title:"Format "+source.name,requirement:"Reopen the exact stored same-format file",
    source:"system-integrity",weight:1,hardGate:true,judgeType:"integrity",validationMethod:"format-roundtrip",minScore:100,
    evidenceExpected:["independent format parsing"],protectedConstraint:false,artifactIds:[source.id],category:"integrity"}));
  const test=(source:SourceArtifact,hidden:boolean)=>TestCaseSchema.parse({id:(hidden?"H-":"V-")+source.id,title:"Format "+source.name,
    input:"Parse the actual stored bytes",expected:["same native format"],hidden,criterionIds:["FMT-"+source.id],executionMode:"roundtrip",evidenceScope:"format"});
  p.evalSuite=sources.map(source=>test(source,false));p.hiddenEvalSuite=sources.map(source=>test(source,true));
  const finalSuite=sources.map(source=>({...test(source,true),id:"FINAL-"+source.id,input:"Independently reopen the exact format at final acceptance"}));
  p.finalHoldout={round:1,suite:finalSuite,paperHash:finalHoldoutPaperHash(finalSuite),contractFingerprint:finalHoldoutContractFingerprint(p),createdAt:new Date().toISOString()};
  const candidate=await materializeServerCandidateArtifacts(p,CandidateSchema.parse({id:"actual-format-candidate",name:"Changed native files",change:"actual field edits",finalHoldoutPaperHash:p.finalHoldout.paperHash}),
    sources.map((source,index)=>({sourceArtifactId:source.id,name:source.name,mimeType:source.mimeType,content:items[index]!.patch})),"Exact native mutations");
  p.candidates=[candidate];p.selectedCandidateIds=[candidate.id];p.experimentRun={...p.experimentRun,status:"completed",winnerId:candidate.id};
  p.campaign={...p.campaign,status:"running",checkpoint:{round:1,completedPhase:"experiment",at:new Date().toISOString()}};
  p.validationRun={...p.validationRun,status:"idle",evaluation:undefined,baselineEvaluation:undefined,runs:[],baselineRuns:[],evidenceFingerprint:undefined};
  const noAi=async()=>{throw Error("deterministic format checks must not use AI");};
  const ports:ServerHoldoutPorts={
    readArtifactFingerprint:readServerHoldoutArtifactFingerprint,
    current:{executeStoredEvidence:runServerCurrentStoredEvidence,executeSemanticBatch:noAi,judge:noAi},
    candidate:{executeSemanticBatch:noAi,judge:noAi,verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,verifyNativeFormat:verifyServerCandidateNativeFormats},
    releaseReview:async payload=>{
      const scores=(payload as {criterionScores:Array<{verificationStatus:string;score:number}>}).criterionScores;
      expect(scores).toHaveLength(12);expect(scores.every(score=>score.verificationStatus==="verified"&&score.score===100)).toBe(true);
      return{recommendation:"release",summary:"Deterministic format-only contract passed",reasons:["Twelve exact-byte native format observations"],risks:[],requiredChecks:[]};
    },
  };
  const holdout=await runServerHoldout(p,ports);
  expect(holdout.readyForArtifactAcceptance,holdout.reason).toBe(true);
  expect(holdout.validation.runs).toHaveLength(12);expect(holdout.validation.baselineRuns).toHaveLength(12);
  expect(holdout.validation.runs.every(run=>run.verificationStatus==="verified")).toBe(true);
  const accepted=await runServerArtifactAcceptance(holdout.project,{verifyFrozenArtifacts:verifyServerFrozenCandidateArtifacts,repairCandidate:noAi,
    verifyIndependentFinal:args=>verifyServerIndependentFinalHoldout(args,current=>runServerHoldout(current,ports))});
  expect(accepted.accepted,accepted.reason).toBe(true);
  expect(accepted.project.searchChampion?.candidate?.id).toBe(candidate.id);
  expect(accepted.project.validationRun.independentFinal?.runs).toHaveLength(12);
  const metadata=materializeAcceptedChampionPackage(accepted.project);
  const delivered=await renderAcceptedProjectArtifacts(accepted.project,metadata,{get:async id=>blobs.get(id),
    put:async()=>{throw Error("accepted bytes must never be regenerated");},delete:async()=>{throw Error("no deletion");}});
  expect(delivered.receipts).toHaveLength(12);
  for(const receipt of delivered.receipts)expect(await sha(blobs.get(receipt.artifactRef)!)).toBe(receipt.sha256);
});
