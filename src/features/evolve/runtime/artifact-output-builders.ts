import JSZip from "jszip";
import { assertDeliverablePackageIdentity, isZipArtifact } from "@evolution/core";
import * as XLSX from "xlsx";
import type { CandidateArtifactSnapshot, SourceArtifact } from "../schemas";
import { getArtifactBlob } from "./artifact-blob-store";
import { describeArtifact } from "./artifact-strategy";
import { readFrozenArtifact } from "./frozen-artifact";
import {renderSpreadsheetOverlay,validateStructuredTextFormat} from "@evolution/adapters";

function xmlEscape(value:string){return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");}
function json<T>(text:string):T|undefined{try{return JSON.parse(text) as T}catch{return undefined}}
function evolvedName(source: SourceArtifact, forcedExt?: string){
  const ext=(forcedExt || source.extension || source.name.split(".").pop() || "").replace(/^\./,"");
  const stem=source.name.replace(/\.[^.]+$/,"");
  return `${stem}-evolved${ext?`.${ext}`:""}`;
}
function replaceXmlRuns(xml: string, runs: Array<string|{index:number;text:string}>, tag: "a:t"|"w:t"){
  const normalized=runs.map((run,index)=>typeof run==="string"?{index,text:run}:run);
  const pattern=tag==="a:t"?/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g:/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  const count=[...xml.matchAll(pattern)].length;
  if(new Set(normalized.map(run=>run.index)).size!==normalized.length
    ||normalized.some(run=>!Number.isInteger(run.index)||run.index<0||run.index>=count||typeof run.text!=="string"))
    throw new Error("文本位置无效或重复；新增段落/页面需要对应格式编辑器，不能静默跳过。");
  const edits=new Map(normalized.map(run=>[run.index,run.text]));
  let cursor=0;
  return xml.replace(pattern,(full)=>{
    const text=edits.get(cursor++);
    if(text===undefined)return full;
    const attributes=full.match(/^<[^\s>]+(\s[^>]*)>/)?.[1]??"";
    return "<"+tag+attributes+">"+xmlEscape(text)+"</"+tag+">";
  });
}


export async function buildDownloadBlob(source: SourceArtifact, snapshot: CandidateArtifactSnapshot): Promise<{blob:Blob;name:string;note:string}> {
  const descriptor=source.artifactDescriptor??describeArtifact(source);
  if(!descriptor.capabilities.materialize || ["rtf", "odt", "odp", "doc", "ppt"].includes(source.extension.toLowerCase())){
    throw new Error(`${source.name} 当前需要外部 ${descriptor.adapterId} Renderer 才能保证同格式交付。系统不会用纯文本冒充 .${source.extension || "原"} 成果。`);
  }
  if(descriptor.adapterId==="presentation-pptx-ooxml"){
    const original=await getArtifactBlob(source.id);
    const blueprint=json<{kind?:string;slides?:Array<{number:number;textRuns?:Array<string|{index:number;text:string}>}>}>(snapshot.content);
    if(original&&blueprint?.slides){
      const zip=await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));
      const seen=new Set<number>();
      let changed=0;
      for(const slide of blueprint.slides){
        if(!Number.isSafeInteger(slide.number)||slide.number<1||seen.has(slide.number)||!slide.textRuns?.length)
          throw new Error("PPTX 必须指定唯一的有效页码和非空 textRuns，不能原包重打包冒充进化。");
        seen.add(slide.number);
        const path="ppt/slides/slide"+slide.number+".xml";
        const entry=zip.file(path);
        if(!entry)throw new Error("原文件没有第 "+slide.number+" 页；新增页面需要原生演示文稿编辑器。");
        const before=await entry.async("string"),after=replaceXmlRuns(before,slide.textRuns,"a:t");
        if(after!==before){zip.file(path,after);changed++;}
      }
      if(!changed)throw new Error("PPTX 没有发生真实文本修改，不能作为进化后的文件交付。");

      return {blob:await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.presentationml.presentation"}),name:evolvedName(source,"pptx"),note:"在原 PPTX OOXML 上回写已验收 slide/text runs，主题、版式与未修改对象保留。"};
    }
    throw new Error("PPTX Candidate Blueprint 缺少 slides/textRuns，不能安全物化同格式成果。");
  }
  if(descriptor.adapterId==="document-docx-ooxml"){
    const original=await getArtifactBlob(source.id);
    const blueprint=json<{kind?:string;subtype?:string;parts?:Array<{path:string;textRuns?:Array<string|{index:number;text:string}>}>}>(snapshot.content);
    if(original&&blueprint?.parts){
      const zip=await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));
      const seen=new Set<string>();
      let changed=0;
      for(const part of blueprint.parts){
        if(!safeArchivePath(part.path)
          ||!/^word\/(?:document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(part.path)
          ||seen.has(part.path)||!part.textRuns?.length)
          throw new Error("DOCX part 路径无效、重复或没有可编辑 textRuns。");
        seen.add(part.path);
        const entry=zip.file(part.path);
        if(!entry)throw new Error("原文件没有 "+part.path+"，无法回写此段落。");
        const before=await entry.async("string"),after=replaceXmlRuns(before,part.textRuns,"w:t");
        if(after!==before){zip.file(part.path,after);changed++;}
      }
      if(!changed)throw new Error("DOCX 没有发生真实文本修改，不能作为进化后的文件交付。");

      return {blob:await zip.generateAsync({type:"blob",mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),name:evolvedName(source,"docx"),note:"在原 DOCX OOXML 上回写已验收文本 run；样式、图片、关系和未修改内容继续保留在原 package 中。"};
    }
    throw new Error("DOCX Candidate Blueprint 缺少 parts/textRuns，不能安全物化同格式成果。");
  }
  if(isZipArtifact(source)){
    const original=await getArtifactBlob(source.id);
    const bundle=json<{kind?:string;files?:Array<{path:string;content:string}>}>(snapshot.content);
    if(original&&bundle?.files){const zip=await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));const paths=new Set<string>();for(const file of bundle.files){if(!safeArchivePath(file.path)||paths.has(file.path))throw new Error(`无效或重复的文件路径：${file.path}`);paths.add(file.path);zip.file(file.path,file.content);}return {blob:await zip.generateAsync({type:"blob"}),name:evolvedName(source,"zip"),note:"在原 ZIP package 上回写 Candidate 文件，所有未修改文件按原样保留。"};}
    throw new Error("ZIP Candidate 缺少 files blueprint；为避免伪造完整工程，已阻止同格式下载。");
  }
  if(descriptor.family==="spreadsheet"){
    const original=await getArtifactBlob(source.id);
    if(!original)throw new Error("Spreadsheet 原始文件缺失，不能从只显示部分行列的预览生成同格式成果。");
    const produced=await renderSpreadsheetOverlay(source,snapshot.content,original);
    return {blob:produced.blob,name:evolvedName(source,source.extension),note:produced.note};
  }
  // 文本 / Prompt / Workflow JSON/YAML / HTML 等：Candidate Snapshot 本身就是被测试、被验收的完整成果。
  return {blob:new Blob([snapshot.content],{type:snapshot.mimeType||source.mimeType||"text/plain;charset=utf-8"}),name:evolvedName(source,source.extension),note:"文本/结构化文本成果直接下载已通过 Hidden + Artifact Acceptance 的 exact Candidate Snapshot。"};
}

export async function buildDeliverableZip(project: import("../schemas").EvolveProject) {
  assertDeliverablePackageIdentity(project);
  const zip=new JSZip();
  for(const artifact of project.outputArtifacts){
    const entryName = artifact.kind === "primary" ? artifact.frozenArtifact?.name : artifact.name;
    if (!entryName || !safeArchivePath(entryName)) throw new Error("交付文件名无效，请重新验收生成有效文件。");
    if (zip.file(entryName)) throw new Error(`交付文件重名：${entryName}，请分别下载或修改源文件名后重新验收。`);
    if(artifact.kind==="primary"){
      if (!artifact.accepted) throw new Error("成果尚未通过验收，不能作为正式交付文件打包。");
      const blob = await readFrozenArtifact(artifact.frozenArtifact, artifact.content);
      const name = artifact.frozenArtifact!.name;
      if (zip.file(name)) throw new Error(`交付文件重名：${name}，请分别下载或修改源文件名后重新验收。`);
      zip.file(name, new Uint8Array(await blob.arrayBuffer()));continue;
    }
    zip.file(artifact.name,artifact.content);
  }
  return zip.generateAsync({type:"blob"});
}

export function safeArchivePath(path: string) {
  return Boolean(path) && !/[\\:]/.test(path) && ![...path].some((char) => char.charCodeAt(0) < 32) && !path.startsWith("/") && !path.split("/").some((p) => !p || p === "." || p === "..");
}

/** Reopen the actual generated bytes and verify every requested write. This is
 * structural evidence only: rendering, recalculation and execution remain separate. */
export async function verifyGeneratedArtifact(source: SourceArtifact, snapshot: CandidateArtifactSnapshot, blob: Blob) {
  const descriptor = source.artifactDescriptor ?? describeArtifact(source);
  const data = json<{ slides?: Array<{number:number;textRuns?:Array<string|{index:number;text:string}>}>; parts?: Array<{path:string;textRuns?:Array<string|{index:number;text:string}>}>; files?:Array<{path:string;content:string}>; sheets?:Array<{name:string;cells?:Array<{address:string;formula?:string;value?:unknown}>;rows?:unknown[][]}> }>(snapshot.content);
  const checks = ["实际文件已生成"];
  const limitations: string[] = [];
  const buffer = await blob.arrayBuffer();
  if (!buffer.byteLength) throw new Error("生成的文件为空。");
  if (descriptor.adapterId === "presentation-pptx-ooxml" || descriptor.adapterId === "document-docx-ooxml" || isZipArtifact(source)) {
    const zip = await JSZip.loadAsync(new Uint8Array(buffer), {checkCRC32:true});
    const original = await getArtifactBlob(source.id);
    if (!original) throw new Error("原始文件不可用，无法核对文件完整性。");
    const originalZip = await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()));
    if (Object.keys(originalZip.files).some((path) => !zip.files[path])) throw new Error("生成文件丢失了原包中的条目。");
    if (isZipArtifact(source)) {
      for (const file of data?.files ?? []) if (!safeArchivePath(file.path) || await zip.file(file.path)?.async("string") !== file.content) throw new Error(`文件写入不一致：${file.path}`);
      limitations.push("已验证文件写入与包完整性；构建、业务测试需真实执行器。");
    } else {
      const isPpt = descriptor.adapterId === "presentation-pptx-ooxml";
      const parts = isPpt ? (data?.slides ?? []).map((s) => ({path:`ppt/slides/slide${s.number}.xml`,textRuns:s.textRuns})) : data?.parts ?? [];
      for (const part of parts) {
        const xml = await zip.file(part.path)?.async("string");
        if (!xml) throw new Error(`生成文件缺少 ${part.path}`);
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        if (doc.getElementsByTagName("parsererror").length) throw new Error(`文件 XML 损坏：${part.path}`);
        const runs = doc.getElementsByTagName(isPpt ? "a:t" : "w:t");
        for (const [i, run] of (part.textRuns ?? []).entries()) {
          const index = typeof run === "string" ? i : run.index;
          if (runs[index]?.textContent !== (typeof run === "string" ? run : run.text)) throw new Error(`文本回写不一致：${part.path} 第 ${index + 1} 块`);
        }
      }
      limitations.push("已核对原格式文本与 XML；页面渲染、图形布局尚需视觉验证。");
    }
    checks.push("压缩包重新打开与 CRC 校验通过", "原包条目保留", "每项请求的修改均已写入");
  } else if (descriptor.family === "spreadsheet") {
    const wb = XLSX.read(buffer, {type:"array",cellFormula:true,cellDates:true});
    for (const sheet of data?.sheets ?? []) {
      const ws = wb.Sheets[sheet.name.slice(0,31)] ?? (["csv","tsv"].includes(source.extension) ? wb.Sheets[wb.SheetNames[0]!] : undefined);
      if (!ws) throw new Error(`工作表丢失：${sheet.name}`);
      for (const cell of sheet.cells ?? []) {
        if (cell.formula !== undefined && !["csv","tsv"].includes(source.extension) && ws[cell.address]?.f !== cell.formula) throw new Error(`公式写入不一致：${sheet.name}!${cell.address}`);
        if (cell.value !== undefined && cell.value !== null && ws[cell.address]?.v !== cell.value) throw new Error(`数据写入不一致：${sheet.name}!${cell.address}`);
      }
      for (const [r, row] of (sheet.rows ?? []).entries()) for (const [c, value] of row.entries()) {
        const address = XLSX.utils.encode_cell({r,c});
        if (value !== null && value !== undefined && !sheet.cells?.some((cell) => cell.address === address) && ws[address]?.v !== value) throw new Error(`行数据写入不一致：${sheet.name}!${address}`);
      }
    }
    checks.push("工作簿重新打开", "修改的单元格与公式逐项核对");
    limitations.push("公式已写入但未执行 Office 重算；宏、图表和外部连接需专用验证。");
  } else {
    if (await blob.text() !== snapshot.content) throw new Error("生成文件与被验收内容不一致。");
    validateStructuredTextFormat({extension:source.extension,content:snapshot.content});
    if (/^(html|htm)$/i.test(source.extension)) {
      if (!/<html\b/i.test(snapshot.content) || !/<\/html\s*>/i.test(snapshot.content) || !/<body\b/i.test(snapshot.content)) throw new Error("HTML 候选缺少完整 html/body 结构，请修复文件后重试。");
      const parsed = new DOMParser().parseFromString(snapshot.content, "text/html");
      if (!parsed.body.textContent?.trim() && !parsed.querySelector("script, img, canvas, iframe, svg")) throw new Error("HTML 候选正文为空，无法作为可用成果。");
      checks.push("HTML 文档容器与非空内容检查通过");
      limitations.push("HTML 结构检查不代表脚本可执行或交互正确；需浏览器 Runner 验证。");
    }
    checks.push("实际文本与候选内容逐字一致");
  }
  return {checks, limitations};
}
