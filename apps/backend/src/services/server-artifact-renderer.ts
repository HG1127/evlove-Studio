import { restoreServerHtmlProtectionAcceptedProject, type ServerHtmlProtectionAcceptedPorts } from "./server-html-protection-accepted-authority";
import { inheritHtmlProtectionAuthorities } from "@evolution/core";
import { decodeArtifactUtf8 } from "@evolution/adapters";
import {createHash} from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import type {ArtifactStorePort,CandidateArtifactSnapshot,EvolveProject,OutputArtifact,SourceArtifact} from "@evolution/contracts";
import {assertPackageEvidenceContents,assertDeliverablePackageIdentity,describeArtifact,hasExactFrozenArtifactSet} from "@evolution/core";
import {getServerArtifactStore} from "./artifact-runtime";

type TextRun=string|{index:number;text:string};
type PresentationBlueprint={slides?:Array<{number:number;textRuns?:TextRun[]}>};
type DocumentBlueprint={parts?:Array<{path:string;textRuns?:TextRun[]}>};
type PackageBlueprint={files?:Array<{path:string;content:string}>};
type SpreadsheetCell={address:string;value?:string|number|boolean|null;formula?:string;type?:string;format?:string};
type SpreadsheetBlueprint={sheets?:Array<{name:string;rows?:Array<Array<string|number|boolean|null>>;cells?:SpreadsheetCell[]}>};

function parseJson<T>(text:string):T|undefined{try{return JSON.parse(text) as T;}catch{return undefined;}}
function xmlEscape(value:string){return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function xmlUnescape(value:string){return value.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");}
function runPattern(tag:"a:t"|"w:t"){return tag==="a:t"?/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g:/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;}
function replaceXmlRuns(xml:string,runs:TextRun[],tag:"a:t"|"w:t"){
  const normalized=runs.map((run,index)=>typeof run==="string"?{index,text:run}:run);
  const pattern=runPattern(tag);
  const count=[...xml.matchAll(pattern)].length;
  if(new Set(normalized.map((run)=>run.index)).size!==normalized.length||normalized.some((run)=>!Number.isInteger(run.index)||run.index<0||run.index>=count||typeof run.text!=="string")){
    throw new Error("OOXML 文本位置无效或重复；新增段落/页面需要专用 Renderer，不能静默跳过。");
  }
  let cursor=0;
  return xml.replace(pattern,(full)=>{
    const replacement=normalized.find((item)=>item.index===cursor++);
    if(!replacement)return full;
    const attr=tag==="w:t"&&/^<w:t\s/.test(full)?full.match(/^<w:t(\s[^>]*)>/)?.[1]??"":"";
    return tag==="a:t"?"<a:t>"+xmlEscape(replacement.text)+"</a:t>":"<w:t"+attr+">"+xmlEscape(replacement.text)+"</w:t>";
  });
}
function readXmlRuns(xml:string,tag:"a:t"|"w:t"){return [...xml.matchAll(runPattern(tag))].map((match)=>xmlUnescape(match[1]??""));}
function safeArchivePath(path:string){return Boolean(path)&&!/[\\:]/.test(path)&&![...path].some((char)=>char.charCodeAt(0)<32)&&!path.startsWith("/")&&!path.split("/").some((part)=>!part||part==="."||part==="..");}
function evolvedName(source:SourceArtifact,forcedExt?:string){
  const ext=(forcedExt||source.extension||source.name.split(".").pop()||"").replace(/^\./,"");
  const stem=source.name.replace(/\.[^.]+$/,"");
  return stem+"-evolved"+(ext?"."+ext:"");
}
async function digest(blob:Blob){return createHash("sha256").update(new Uint8Array(await blob.arrayBuffer())).digest("hex");}
function binaryBlob(bytes:Uint8Array,type:string){
  const copy=new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer],{type});
}
async function originalBlob(source:SourceArtifact,store:ArtifactStorePort){return store.get(source.storageRef?.trim()||source.id);}

export async function renderSnapshot(source:SourceArtifact,snapshot:CandidateArtifactSnapshot,store:ArtifactStorePort,baseBlob?:Blob){
  const descriptor=source.artifactDescriptor??describeArtifact(source);
  const extension=source.extension.toLowerCase();
  if(!descriptor.capabilities.materialize||descriptor.preservationMode==="external-required"||["rtf","odt","odp","doc","ppt"].includes(extension)){
    throw new Error(source.name+" 需要外部 "+descriptor.adapterId+" Renderer；Server 不会用文本伪造同格式成果。");
  }
  if(descriptor.adapterId==="presentation-pptx-ooxml"){
    const original=baseBlob??await originalBlob(source,store);
    const blueprint=parseJson<PresentationBlueprint>(snapshot.content);
    if(!original||!blueprint?.slides)throw new Error("PPTX Server Renderer 需要原始 package 与 slides/textRuns blueprint。");
    const zip=await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));
    for(const slide of blueprint.slides){
      const path="ppt/slides/slide"+slide.number+".xml";
      const entry=zip.file(path);
      if(!entry)throw new Error("原 PPTX 没有第 "+slide.number+" 页；新增页面需要专用演示文稿 Renderer。");
      zip.file(path,replaceXmlRuns(await entry.async("string"),slide.textRuns??[],"a:t"));
    }
    return {blob:binaryBlob(await zip.generateAsync({type:"uint8array"}),source.mimeType),name:evolvedName(source,"pptx"),note:"Server 在原 PPTX OOXML package 上回写已验收 text runs；主题、版式、图片和未修改对象保留。"};
  }
  if(descriptor.adapterId==="document-docx-ooxml"){
    const original=baseBlob??await originalBlob(source,store);
    const blueprint=parseJson<DocumentBlueprint>(snapshot.content);
    if(!original||!blueprint?.parts)throw new Error("DOCX Server Renderer 需要原始 package 与 parts/textRuns blueprint。");
    const zip=await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));
    for(const part of blueprint.parts){
      if(!safeArchivePath(part.path))throw new Error("无效 DOCX part path："+part.path);
      const entry=zip.file(part.path);
      if(!entry)throw new Error("原 DOCX 没有 "+part.path+"，无法安全回写。");
      zip.file(part.path,replaceXmlRuns(await entry.async("string"),part.textRuns??[],"w:t"));
    }
    return {blob:binaryBlob(await zip.generateAsync({type:"uint8array"}),source.mimeType),name:evolvedName(source,"docx"),note:"Server 在原 DOCX OOXML package 上回写已验收 text runs；样式、图片、关系与未修改内容保留。"};
  }
  if(descriptor.family==="codebase"||descriptor.family==="package"){
    const original=baseBlob??await originalBlob(source,store);
    const blueprint=parseJson<PackageBlueprint>(snapshot.content);
    if(!original||!blueprint?.files)throw new Error("ZIP/Code package Server Renderer 需要原始 package 与 files blueprint。");
    const zip=await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));
    const seen=new Set<string>();
    for(const file of blueprint.files){
      if(!safeArchivePath(file.path)||seen.has(file.path))throw new Error("无效或重复的 package path："+file.path);
      seen.add(file.path);zip.file(file.path,file.content);
    }
    return {blob:binaryBlob(await zip.generateAsync({type:"uint8array"}),source.mimeType||"application/zip"),name:evolvedName(source,"zip"),note:"Server 在原 package 上回写 Candidate 文件，未修改条目原样保留。"};
  }
  if(descriptor.family==="spreadsheet"){
    const blueprint=parseJson<SpreadsheetBlueprint>(snapshot.content);
    if(!blueprint?.sheets)throw new Error("Spreadsheet Server Renderer 缺少 sheets blueprint。");
    if(extension==="csv"||extension==="tsv"){
      const first=blueprint.sheets[0];
      const ws=XLSX.utils.aoa_to_sheet(first?.rows??[]);
      for(const cell of first?.cells??[]){
        if(!cell.address)continue;
        const prior=(ws[cell.address]??{}) as XLSX.CellObject;
        const next:XLSX.CellObject={...prior};
        if(cell.formula!==undefined)next.f=cell.formula;
        if(cell.value!==undefined)next.v=cell.value as XLSX.CellObject["v"];
        if(cell.type)next.t=cell.type as XLSX.CellObject["t"];
        if(cell.format)next.z=cell.format;
        ws[cell.address]=next;
      }
      const text=XLSX.utils.sheet_to_csv(ws,{FS:extension==="tsv"?"\t":","});
      return {blob:new Blob([text],{type:extension==="tsv"?"text/tab-separated-values":"text/csv"}),name:evolvedName(source,extension),note:"Server 按已验收 Sheet/Cell Blueprint 输出同格式 ."+extension+"。"};
    }
    const original=baseBlob??await originalBlob(source,store);
    const workbook=original?XLSX.read(await original.arrayBuffer(),{type:"array",cellFormula:true,cellStyles:true,cellDates:true,bookVBA:true}):XLSX.utils.book_new();
    for(const sheet of blueprint.sheets){
      const safeName=sheet.name.slice(0,31);
      let ws=workbook.Sheets[safeName];
      if(!ws){ws=XLSX.utils.aoa_to_sheet([]);XLSX.utils.book_append_sheet(workbook,ws,safeName);}
      if(sheet.rows?.length)XLSX.utils.sheet_add_aoa(ws,sheet.rows,{origin:"A1"});
      for(const cell of sheet.cells??[]){
        if(!cell.address)continue;
        const prior=(ws[cell.address]??{}) as XLSX.CellObject;
        const next:XLSX.CellObject={...prior};
        if(cell.formula!==undefined){
          next.f=cell.formula;
          if(cell.value===undefined&&next.v===undefined)next.v=0;
        }
        if(cell.value!==undefined)next.v=cell.value as XLSX.CellObject["v"];
        if(cell.type)next.t=cell.type as XLSX.CellObject["t"];
        if(cell.format)next.z=cell.format;
        ws[cell.address]=next;
      }
    }
    const bookType=(extension==="xls"?"xls":extension==="ods"?"ods":"xlsx") as XLSX.BookType;
    const bytes=XLSX.write(workbook,{type:"array",bookType,bookVBA:true});
    return {blob:new Blob([bytes],{type:source.mimeType||"application/octet-stream"}),name:evolvedName(source,extension||"xlsx"),note:original?"Server 以原工作簿为基底写回已验收 Sheet/Cell/Formula。":"Server 按结构化 Blueprint 重建工作簿；复杂样式保真受限。"};
  }
  return {blob:new Blob([snapshot.content],{type:snapshot.mimeType||source.mimeType||"text/plain;charset=utf-8"}),name:evolvedName(source,source.extension),note:"Server 直接物化已通过验收的 exact text/structured snapshot。"};
}

export async function verifyRendered(source:SourceArtifact,snapshot:CandidateArtifactSnapshot,blob:Blob,store:ArtifactStorePort,baseBlob?:Blob){
  const descriptor=source.artifactDescriptor??describeArtifact(source);
  const checks:string[]=["实际文件已生成"];
  const limitations:string[]=[];
  if(!blob.size)throw new Error("Server Renderer 生成了空文件。");
  if(descriptor.adapterId==="presentation-pptx-ooxml"||descriptor.adapterId==="document-docx-ooxml"||descriptor.family==="codebase"||descriptor.family==="package"){
    const rendered=await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()),{checkCRC32:true});
    const original=baseBlob??await originalBlob(source,store);
    if(!original)throw new Error("原始 package 不可用，无法验证条目完整性。");
    const originalZip=await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));
    if(Object.keys(originalZip.files).some((path)=>!rendered.files[path]))throw new Error("Server Renderer 丢失原 package 条目。");
    if(descriptor.family==="codebase"||descriptor.family==="package"){
      const data=parseJson<PackageBlueprint>(snapshot.content);
      for(const file of data?.files??[])if(!safeArchivePath(file.path)||await rendered.file(file.path)?.async("string")!==file.content)throw new Error("Server Renderer 文件写入不一致："+file.path);
    }else{
      const isPpt=descriptor.adapterId==="presentation-pptx-ooxml";
      const parts=isPpt?(parseJson<PresentationBlueprint>(snapshot.content)?.slides??[]).map((slide)=>({path:"ppt/slides/slide"+slide.number+".xml",textRuns:slide.textRuns})):(parseJson<DocumentBlueprint>(snapshot.content)?.parts??[]);
      for(const part of parts){
        const xml=await rendered.file(part.path)?.async("string");
        if(!xml)throw new Error("Server Renderer 缺少 "+part.path);
        const actual=readXmlRuns(xml,isPpt?"a:t":"w:t");
        for(const [fallback,run] of (part.textRuns??[]).entries()){
          const normalized=typeof run==="string"?{index:fallback,text:run}:run;
          if(actual[normalized.index]!==normalized.text)throw new Error("Server OOXML 回写不一致："+part.path+" #"+normalized.index);
        }
      }
      limitations.push("OOXML 结构与文本回写已验证；最终页面渲染仍由 Browser/Visual Judge 验证。");
    }
    checks.push("ZIP/OOXML 可重新打开且 CRC 通过","原 package 条目完整保留","请求修改逐项核对");
  }else if(descriptor.family==="spreadsheet"){
    const data=parseJson<SpreadsheetBlueprint>(snapshot.content);
    const workbook=XLSX.read(await blob.arrayBuffer(),{type:"array",cellFormula:true,cellDates:true});
    for(const sheet of data?.sheets??[]){
      const ws=workbook.Sheets[sheet.name.slice(0,31)]??(["csv","tsv"].includes(source.extension)?workbook.Sheets[workbook.SheetNames[0]!] : undefined);
      if(!ws)throw new Error("Server Renderer 工作表丢失："+sheet.name);
      for(const cell of sheet.cells??[]){
        if(cell.formula!==undefined&&!["csv","tsv"].includes(source.extension)&&ws[cell.address]?.f!==cell.formula)throw new Error("Server Renderer 公式写入不一致："+sheet.name+"!"+cell.address);
        if(cell.value!==undefined&&cell.value!==null&&ws[cell.address]?.v!==cell.value)throw new Error("Server Renderer 数据写入不一致："+sheet.name+"!"+cell.address);
      }
    }
    checks.push("工作簿重新打开","修改单元格/公式逐项核对");
    limitations.push("未执行 Office 公式重算；宏、复杂图表与外部连接仍需专用 Office 验证。");
  }else{
    if(decodeArtifactUtf8(await blob.arrayBuffer())!==snapshot.content)throw new Error("Server Renderer 文本结果与 Candidate Snapshot 不一致。");
    checks.push("生成文本与 Candidate Snapshot 逐字一致");
  }
  return {checks,limitations};
}

export async function renderAcceptedProjectArtifacts(
  project:EvolveProject,
  artifacts:OutputArtifact[],
  store:ArtifactStorePort=getServerArtifactStore(),
  protectionPorts:ServerHtmlProtectionAcceptedPorts={},
){
  const candidateId=artifacts.filter(artifact=>artifact.kind==="primary")[0]?.candidateId;
  if(!candidateId)throw Error("Accepted primary Candidate is missing; Primary artifact 集合未完整覆盖 Gate F Target。");
  // Reject corrupt package DTOs before physical reads; this pure check grants no acceptance authority.
  const packageChampion=artifacts.find(artifact=>artifact.kind==="primary")?.isChampion?project.searchChampion:undefined;
  const packageCandidate=packageChampion?.candidate??project.candidates.find(item=>item.id===candidateId);
  const packageAcceptance=packageChampion?.artifactAcceptance??project.artifactAcceptance;
  const packageValidation=packageChampion?.validation??project.validationRun;
  if(!packageCandidate||!packageAcceptance||!packageValidation)throw Error("Accepted package evidence context missing");
  assertPackageEvidenceContents({project,artifacts,candidate:packageCandidate,champion:packageChampion,acceptance:packageAcceptance,validation:packageValidation});
  const restored=await restoreServerHtmlProtectionAcceptedProject({project,candidateId},{...protectionPorts,store});
  project=restored.project;
  const targets=project.sourceArtifacts.filter((source)=>source.role==="target");
  const primary=artifacts.filter((artifact)=>artifact.kind==="primary");
  if(primary.length!==targets.length)throw new Error("Primary artifact 集合未完整覆盖 Gate F Target。");
  const champion=primary[0]?.isChampion?project.searchChampion:undefined;
  const candidate=champion?.candidate??project.candidates.find((item)=>item.id===project.experimentRun.winnerId);
  const acceptance=champion?.artifactAcceptance??project.artifactAcceptance;
  if(!candidate||!acceptance||acceptance.status!=="passed"||acceptance.candidateId!==candidate.id
    ||!hasExactFrozenArtifactSet(project,candidate,acceptance)){
    throw new Error("Server Renderer 只允许 Gate F 已通过且冻结身份完整的 Candidate 成果包。");
  }
  const sourceById=new Map(targets.map((source)=>[source.id,source]));
  const snapshotBySource=new Map(candidate.artifactSnapshots.map((snapshot)=>[snapshot.sourceArtifactId,snapshot]));
  const frozenBySource=new Map(acceptance.frozenArtifacts!.map((item)=>[item.sourceArtifactId,item]));
  const seen=new Set<string>();
  for(const artifact of primary){
    const sourceId=artifact.sourceArtifactIds[0];
    if(!artifact.accepted||artifact.projectId!==project.id||artifact.candidateId!==candidate.id
      ||artifact.sourceArtifactIds.length!==1||!sourceId||seen.has(sourceId)||!sourceById.has(sourceId)){
      throw new Error("Primary artifact 无法唯一绑定当前已验收 Target/Candidate。");
    }
    seen.add(sourceId);
    const snapshot=snapshotBySource.get(sourceId)!;
    const frozen=frozenBySource.get(sourceId)!;
    if(snapshot.contentHash&&frozen.snapshotHash!==snapshot.contentHash){
      throw new Error("Primary artifact "+artifact.name+" Candidate Snapshot 已偏离 Gate F frozen hash。");
    }
    if(artifact.frozenArtifact&&(
      artifact.frozenArtifact.sourceArtifactId!==frozen.sourceArtifactId
      ||artifact.frozenArtifact.snapshotHash!==frozen.snapshotHash
      ||artifact.frozenArtifact.blobId!==frozen.blobId
      ||artifact.frozenArtifact.sha256!==frozen.sha256
      ||artifact.frozenArtifact.size!==frozen.size
      ||artifact.frozenArtifact.name!==frozen.name
      ||artifact.frozenArtifact.mimeType!==frozen.mimeType
    ))throw new Error("Primary artifact "+artifact.name+" 的冻结引用与 Gate F 不一致。");
  }
  const packageView={...project,outputArtifacts:artifacts};
  inheritHtmlProtectionAuthorities(project,packageView);
  assertDeliverablePackageIdentity(packageView);
  const receipts:Array<{sourceArtifactId:string;artifactRef:string;sha256:string;size:number;name:string}>=[];
  const rendered:OutputArtifact[]=[];
  for(const artifact of artifacts){
    if(artifact.kind!=="primary"){rendered.push(artifact);continue;}
    const sourceId=artifact.sourceArtifactIds[0]!;
    const snapshot=snapshotBySource.get(sourceId)!;
    const frozen=frozenBySource.get(sourceId)!;
    if(createHash("sha256").update(snapshot.content,"utf8").digest("hex")!==frozen.snapshotHash){
      throw new Error("Candidate Snapshot 正文与 Gate F snapshot hash 不一致。");
    }
    const blob=await store.get(frozen.blobId);
    if(!blob)throw new Error("找不到 Gate F 冻结 Artifact Blob "+frozen.blobId+"。");
    if(blob.size!==frozen.size)throw new Error("Gate F 冻结 Artifact Blob 大小与凭证不一致。");
    if(await digest(blob)!==frozen.sha256)throw new Error("Gate F 冻结 Artifact Blob SHA-256 与凭证不一致。");
    receipts.push({sourceArtifactId:sourceId,artifactRef:frozen.blobId,sha256:frozen.sha256,size:frozen.size,name:artifact.name});
    rendered.push({
      ...artifact,
      frozenArtifact:frozen,
      renderedArtifactRef:frozen.blobId,
      renderedSha256:frozen.sha256,
      renderedSize:frozen.size,
      renderedMimeType:frozen.mimeType,
      renderedAt:new Date().toISOString(),
      renderNote:"交付 Gate F 已验收并回读校验的同一份冻结 Artifact；未重新生成字节。",
      renderChecks:["Gate F 冻结身份与 Target 一一对应","Storage Blob 大小与 SHA-256 回读一致"],
      renderLimitations:[],
    });
  }
  await restored.assertStable();
  return {outputArtifacts:rendered,receipts};
}
