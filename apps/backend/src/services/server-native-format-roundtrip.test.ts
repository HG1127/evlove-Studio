// @vitest-environment node
import {createHash} from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema,SourceArtifactSchema,type EvolveProject,type TestCase} from "@evolution/contracts";
import {inspectServerNativeFormat} from "./server-native-format-roundtrip";
import {runServerCurrentStoredEvidence} from "./server-current-stored-evidence";
import {verifyServerCandidateNativeFormats} from "./server-candidate-native-roundtrip";
import {verifyServerCandidateFrozenArtifact} from "./server-experiment-artifacts";
import {executeServerExperimentCandidate} from "@evolution/harness";

const blobs=vi.hoisted(()=>new Map<string,Blob>());
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({
  get:async(id:string)=>blobs.get(id),
  put:async()=>{throw Error("Native verification must not write")},
})}));
beforeEach(()=>blobs.clear());
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function source(name:string,bytes:Uint8Array){
  const ext=name.split(".").pop()!;
  return SourceArtifactSchema.parse({
    id:"source",name,extension:ext,
    mimeType:ext==="json"?"application/json":ext==="jsonl"?"application/x-ndjson":
      ext==="csv"?"text/csv":ext==="tsv"?"text/tab-separated-values":
      ext==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ext==="docx"?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ext==="pptx"?"application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "application/zip",
    role:"target",artifactKind:["xlsx","csv","tsv"].includes(ext)?"spreadsheet":
      ext==="zip"?"codebase":ext==="pptx"?"presentation":"document",
    size:bytes.length,inputMode:"upload",parseStatus:"ready",
    storageRef:"original-source",createdAt:"2026-10-21T00:00:00.000Z",
  });
}
function testCase():TestCase{
  return {id:"H-FORMAT",title:"native format",input:"structural format roundtrip",
    expected:["can parse original format"],hidden:true,tags:[],criterionIds:["FORMAT"],
    executionMode:"roundtrip",evidenceScope:"format"};
}
function project(src:ReturnType<typeof source>):EvolveProject{
  return {id:"native-test",version:"V1",sourceArtifacts:[src],
    acceptanceRubric:[{id:"FORMAT",artifactIds:[src.id]}],evalSuite:[]} as unknown as EvolveProject;
}
function candidate(src:ReturnType<typeof source>,bytes:Uint8Array,content:string){
  const contentHash=createHash("sha256").update(content).digest("hex");
  return CandidateSchema.parse({id:"C1",name:"C",change:"native edit",artifactSnapshots:[{
    id:"snapshot",sourceArtifactId:src.id,name:src.name,mimeType:src.mimeType,
    content,contentHash,createdAt:"2026-10-21T00:00:00.000Z",
    frozenArtifact:{sourceArtifactId:src.id,snapshotHash:contentHash,
      blobId:"frozen-1",name:src.name,mimeType:src.mimeType,
      sha256:sha(bytes),size:bytes.length,verifiedAt:"2026-10-21T00:00:00.000Z",
      checks:["synthetic frozen file"],limitations:[]},
  }]});
}
async function zipBytes(entries:Record<string,string|Uint8Array>){
  const zip=new JSZip();
  for(const [path,contents] of Object.entries(entries))zip.file(path,contents);
  return new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"STORE"}));
}
async function word(){
  return zipBytes({
    "[Content_Types].xml":"<Types/>","_rels/.rels":"<Relationships/>",
    "word/document.xml":'<w:document><w:body><w:p><w:t xml:space="preserve">Changed</w:t></w:p></w:body></w:document>',
    "word/media/untouched.png":new Uint8Array([1,0,250]),
  });
}
async function slides(){
  return zipBytes({
    "[Content_Types].xml":"<Types/>","_rels/.rels":"<Relationships/>",
    "ppt/presentation.xml":"<p:presentation><p:sldIdLst/></p:presentation>",
    "ppt/slides/slide1.xml":'<p:sld><a:t>Revised</a:t></p:sld>',
    "ppt/media/untouched.png":new Uint8Array([5,0,2]),
  });
}
function excel(){
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    ["ID","Amount"],["000123",15],["000124",9],
  ]),"Sales");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Locked"],["keep"]]),"Notes");
  return new Uint8Array(XLSX.write(wb,{type:"array",bookType:"xlsx"}) as ArrayBuffer);
}

describe("independent native format roundtrip (not model/visual/runtime quality)",()=>{
  it("independently checks native OOXML parts, text indexes, and preserved assets",async()=>{
    const doc=await word(),ppt=await slides();
    const wordSrc=source("report.docx",doc);
    const pptSrc=source("slides.pptx",ppt);
    const wordPlan=JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Changed"}]}]});
    const pptPlan=JSON.stringify({kind:"presentation",slides:[{number:1,textRuns:[{index:0,text:"Revised"}]}]});
    expect(await inspectServerNativeFormat({source:wordSrc,bytes:doc,snapshot:candidate(wordSrc,doc,wordPlan).artifactSnapshots[0]})).toContain("DOCX");
    expect(await inspectServerNativeFormat({source:pptSrc,bytes:ppt,snapshot:candidate(pptSrc,ppt,pptPlan).artifactSnapshots[0]})).toContain("PPTX");
    const broken=new JSZip();broken.file("word/document.xml","<w:document/>");
    await expect(inspectServerNativeFormat({source:wordSrc,bytes:await zipBytes({"word/document.xml":"<w:document/>"})})).rejects.toThrow(/清单/);
    await expect(inspectServerNativeFormat({
      source:wordSrc,bytes:doc,snapshot:candidate(wordSrc,doc,
        JSON.stringify({kind:"document",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"Fabricated"}]}]})).artifactSnapshots[0],
    })).rejects.toThrow(/不一致/);
  });

  it("verifies actual XLSX Sheet/A1 changes but does not calculate formulas",async()=>{
    const bytes=excel(),src=source("sales.xlsx",bytes);
    const changed=JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sales",cells:[{address:"B2",value:15}]}]});
    expect(await inspectServerNativeFormat({source:src,bytes,snapshot:candidate(src,bytes,changed).artifactSnapshots[0]})).toContain("未");
    await expect(inspectServerNativeFormat({source:src,bytes,snapshot:candidate(src,bytes,
      JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sales",cells:[{address:"B2",value:999}]}]})).artifactSnapshots[0]}))
      .rejects.toThrow(/不一致/);
  });

  it("retains CSV codes with leading zeros and rejects incorrect A1 cell content",async()=>{
    const bytes=new TextEncoder().encode("code,value\r\n000123,15\r\n000124,9\r\n");
    const src=source("sales.csv",bytes);
    const actual=JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"B2",value:15},{address:"A2",value:"000123"}]}]});
    expect(await inspectServerNativeFormat({source:src,bytes,snapshot:candidate(src,bytes,actual).artifactSnapshots[0]})).toContain("CSV");
    await expect(inspectServerNativeFormat({source:src,bytes,snapshot:candidate(src,bytes,
      JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"A2",value:"123"}]}]})).artifactSnapshots[0]}))
      .rejects.toThrow(/不一致/);
    await expect(inspectServerNativeFormat({source:src,bytes:new Uint8Array([0,10,20])})).rejects.toThrow();
  });

  it("checks every ZIP CRC even when frozen SHA receipt matches the corrupt package",async()=>{
    const bytes=await zipBytes({"src/app.ts":"export const done = true;","assets/icon.bin":new Uint8Array([1,0,2])});
    const src=source("repo.zip",bytes),content=JSON.stringify({kind:"codebase",overlay:true,files:[
      {path:"src/app.ts",content:"export const done = true;"},
    ],deletions:[]});
    expect(await inspectServerNativeFormat({source:src,bytes,snapshot:candidate(src,bytes,content).artifactSnapshots[0]})).toContain("CRC");
    const bad=bytes.slice(),needle=new TextEncoder().encode("export const done = true;");
    const start=bad.findIndex((value,i)=>value===needle[0]&&needle.every((b,j)=>bad[i+j]===b));
    expect(start).toBeGreaterThan(0);
    bad[start+6]^=1; // CRC central directory remains unchanged.
    await expect(inspectServerNativeFormat({source:src,bytes:bad})).rejects.toThrow();
    // Synthetic receipt updated to the corrupt SHA: identity passes, format must not.
    const corrupted=candidate(src,bad,content);
    blobs.set("frozen-1",new Blob([bad]));
    const result=await verifyServerCandidateNativeFormats({project:project(src),candidate:corrupted,
      testCase:testCase(),snapshots:corrupted.artifactSnapshots});
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/CRC|Corrupted|错/);
  });

  it("the actual Experiment format gate checks ZIP CRC in addition to frozen SHA before VERIFIED",async()=>{
    const bytes=await zipBytes({"src/app.ts":"export const valid = true;","bin/image.png":new Uint8Array([1,3,5])});
    const src=source("repo.zip",bytes);
    const content=JSON.stringify({kind:"codebase",files:[{path:"src/app.ts",content:"export const valid = true;"}]});
    const cand=candidate(src,bytes,content);
    const p=project(src);
    p.acceptanceRubric[0]!.validationMethod="format-roundtrip";
    blobs.set("frozen-1",new Blob([bytes]));
    const ports={
      executeSemanticBatch:async()=>({results:[]}),
      verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,
      verifyNativeFormat:verifyServerCandidateNativeFormats,
      judge:async()=>({} as never),
    };
    const runs=await executeServerExperimentCandidate(p,cand,ports,[testCase()]);
    expect(runs[0]?.verificationStatus).toBe("verified");
    expect(runs[0]?.trace.some(step=>step.id==="server-frozen-native-H-FORMAT"&&step.status==="pass")).toBe(true);
    // Make an equally SHA-consistent receipt for a physically corrupt ZIP.
    const bad=bytes.slice(),needle=new TextEncoder().encode("export const valid = true;");
    const offset=bad.findIndex((value,i)=>value===needle[0]&&needle.every((b,j)=>bad[i+j]===b));
    bad[offset+7]^=1;
    const forged=candidate(src,bad,content);
    blobs.set("frozen-1",new Blob([bad]));
    expect(await verifyServerCandidateFrozenArtifact(forged.artifactSnapshots[0]!)).toBe(true);
    const rejected=await executeServerExperimentCandidate(p,forged,ports,[testCase()]);
    expect(rejected[0]?.verificationStatus).toBe("unverified");
    expect(rejected[0]?.output).not.toContain("ROUNDTRIP VERIFIED");
  });
  it("parses JSON and JSONL syntax instead of mistaking UTF-8 byte equality for valid structured text",async()=>{
    const valid=new TextEncoder().encode('{"ok":true,"count":3}');
    const json=source("config.json",valid);
    expect(await inspectServerNativeFormat({source:json,bytes:valid,snapshot:candidate(json,valid,new TextDecoder().decode(valid)).artifactSnapshots[0]})).toContain("JSON 语法");
    const invalid=new TextEncoder().encode('{"ok":,}');
    const bad=source("broken.json",invalid);
    await expect(inspectServerNativeFormat({source:bad,bytes:invalid,snapshot:candidate(bad,invalid,new TextDecoder().decode(invalid)).artifactSnapshots[0]})).rejects.toThrow(/语法/);
    const jsonl=new TextEncoder().encode('{"id":1}\n{"id":2}\n');
    expect(await inspectServerNativeFormat({source:source("events.jsonl",jsonl),bytes:jsonl})).toContain("2 条");
    const badJsonl=new TextEncoder().encode('{"id":1}\n{broken}\n');
    await expect(inspectServerNativeFormat({source:source("events.jsonl",badJsonl),bytes:badJsonl})).rejects.toThrow(/第 2 条/);
  });
  it("rejects malformed JSON at the actual Candidate frozen-format gate even with matching SHA",async()=>{
    const bytes=new TextEncoder().encode('{"a":}');
    const src=source("broken.json",bytes),content=new TextDecoder().decode(bytes);
    const cand=candidate(src,bytes,content),p=project(src);
    p.acceptanceRubric[0]!.validationMethod="format-roundtrip";
    blobs.set("frozen-1",new Blob([bytes]));
    const result=await executeServerExperimentCandidate(p,cand,{
      executeSemanticBatch:async()=>({results:[]}),
      verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,
      verifyNativeFormat:verifyServerCandidateNativeFormats,
      judge:async()=>({} as never),
    },[testCase()]);
    expect(result[0]?.verificationStatus).toBe("unverified");
    expect(result[0]?.output).toContain("JSON 语法解析失败");
  });
  it("refuses unsupported PDF/images even if a matching SHA receipt was minted",async()=>{
    const bytes=new TextEncoder().encode("%PDF-1.7 fake but hashable");
    const src=source("document.pdf",bytes);
    src.mimeType="application/pdf";
    const cand=candidate(src,bytes,JSON.stringify({kind:"document",content:"summary only"}));
    blobs.set("frozen-1",new Blob([bytes]));
    expect(await verifyServerCandidateFrozenArtifact(cand.artifactSnapshots[0]!)).toBe(true);
    const checked=await verifyServerCandidateNativeFormats({project:project(src),candidate:cand,testCase:testCase(),
      snapshots:cand.artifactSnapshots});
    expect(checked.passed).toBe(false);
    expect(checked.detail).toContain("尚未接入");
  });
  it("rejects malformed YAML/XML through the actual independent Baseline syntax validator",async()=>{
    for(const [extension,contents] of [["yaml","ok: [unterminated"],["xml","<root><item></root>"]] as const){
      const current=project(source("settings."+extension,new TextEncoder().encode(contents)));
      blobs.set("original-source",new Blob([contents]));
      const result=await runServerCurrentStoredEvidence({project:current,testCase:testCase()});
      expect(result.verificationStatus,extension).toBe("unverified");
      expect(result.output).toContain("解析失败");
    }
  });
  it("uses actual uploaded/champion native bytes for baseline roundtrip, not JSON instructions",async()=>{
    const csvBytes=new TextEncoder().encode("code,value\n000123,15\n");
    const csv=source("sales.csv",csvBytes);
    const current=project(csv);
    blobs.set("original-source",new Blob([csvBytes]));
    const original=await runServerCurrentStoredEvidence({project:current,testCase:testCase()});
    expect(original.verificationStatus).toBe("verified");
    expect(original.artifactHash).toBe(sha(csvBytes));
    const plan=JSON.stringify({kind:"spreadsheet",sheets:[{name:"Sheet1",cells:[{address:"B2",value:15}]}]});
    const accepted=candidate(csv,csvBytes,plan);
    blobs.set("frozen-1",new Blob([csvBytes]));
    current.searchChampion={id:"S1",candidate:accepted,
      validation:{status:"completed",recommendation:"release"},
      artifactAcceptance:{status:"passed",candidateId:"C1"}} as EvolveProject["searchChampion"];
    const reused=await runServerCurrentStoredEvidence({project:current,testCase:testCase()});
    expect(reused.verificationStatus).toBe("verified");
    expect(reused.output).toContain("NATIVE FORMAT");
    expect(reused.output).not.toContain("Snapshot 内容不一致");
    const behavior=await runServerCurrentStoredEvidence({project:current,
      testCase:{...testCase(),evidenceScope:"product-behavior"}});
    expect(behavior.verificationStatus).toBe("unverified");
  });
});
