import JSZip, {type JSZipObject} from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import {
  SourceArtifactSchema,
  type ArtifactKind,
  type ArtifactRole,
  type SourceArtifact,
} from "@evolution/contracts";
import {describeArtifact} from "@evolution/core";
import {assertServerZipEntryBudget,safeServerZipPath,serverZipCrc32} from "./server-codebase-zip-index";

const MAX_TEXT_CHARS=160_000;
const MAX_ZIP_FILES=2_000;
const MAX_ZIP_TEXT_FILES=220;
const MAX_ZIP_FILE_CHARS=24_000;
const MAX_ZIP_TOTAL_CHARS=520_000;
const MAX_ZIP_ARCHIVE_BYTES=25_000_000;
const MAX_PDF_FILE_BYTES=20_000_000;
const MAX_PDF_PAGES=100;
const MAX_PDF_PAGE_ITEMS=10_000;
const MAX_PDF_TEXT_CHARS=150_000;
const MAX_ZIP_TEXT_ENTRY_BYTES=250_000;
const MAX_ZIP_INDEX_BYTES=8_000_000;
const MAX_ZIP_MANIFEST_CHARS=200_000;
const IGNORED_ZIP_PATH=/(^|\/)(?:node_modules|\.git|dist|build|coverage|vendor|\.next)\//i;
const TEXT_EXTS=new Set([
  "txt","md","mdx","html","htm","css","scss","less","js","jsx","ts","tsx","mjs","cjs",
  "json","yaml","yml","xml","svg","csv","tsv","py","go","rs","java","kt","php","sql","vue","svelte",
]);
const CODE_EXTS=new Set(["js","jsx","ts","tsx","mjs","cjs","py","go","rs","java","kt","php","sql","vue","svelte","css","scss"]);

function extension(name:string){
  const clean=name.toLowerCase().split(/[?#]/)[0]??"";
  const part=clean.split(".").pop()??"";
  return part===clean?"":part;
}
function xmlUnescape(value:string){
  return value.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
}
function decode(buffer:Uint8Array){
  return new TextDecoder("utf-8",{fatal:false}).decode(buffer);
}
function binaryLike(text:string){
  if(!text)return true;
  const sample=text.slice(0,8000);
  let controls=0;
  for(const ch of sample){
    const code=ch.charCodeAt(0);
    if(code===0||(code<9)||(code>13&&code<32))controls+=1;
  }
  return controls/Math.max(1,sample.length)>0.02;
}
function stripXml(value:string){
  return xmlUnescape(
    value
      .replace(/<text:tab[^>]*\/?>/g,"\t")
      .replace(/<text:line-break[^>]*\/?>/g,"\n")
      .replace(/<\/(?:text:p|text:h|text:list-item|table:table-row)>/g,"\n")
      .replace(/<[^>]+>/g," "),
  ).replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").trim();
}
function parseRtf(buffer:Uint8Array){
  const raw=new TextDecoder("windows-1252",{fatal:false}).decode(buffer);
  const text=raw
    .replace(/\\par[d]?\b/g,"\n")
    .replace(/\\tab\b/g,"\t")
    .replace(/\\'[0-9a-fA-F]{2}/g,(token)=>String.fromCharCode(Number.parseInt(token.slice(2),16)))
    .replace(/\\u(-?\d+)\??/g,(_,value)=>String.fromCharCode((Number(value)+65536)%65536))
    .replace(/\\[a-zA-Z]+-?\d* ?/g,"")
    .replace(/[{}]/g,"")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
  return {text,structure:["rtf-body"],structuredContent:{kind:"document",subtype:"rtf",approximate:true}};
}
async function parseOpenDocument(buffer:Uint8Array,ext:string){
  const zip=await JSZip.loadAsync(buffer);
  const content=await zip.file("content.xml")?.async("string");
  if(!content)throw new Error("OpenDocument 中未找到 content.xml");
  const text=stripXml(content);
  const kind=ext==="ods"?"spreadsheet":ext==="odp"?"presentation":"document";
  const structure=["content.xml",...Object.keys(zip.files).filter((name)=>/^(styles|meta|settings)\.xml$/.test(name))];
  return {text,structure,structuredContent:{kind,subtype:ext,source:"content.xml"}};
}
function familyForPath(path:string){
  const ext=extension(path);
  if(CODE_EXTS.has(ext))return "code";
  if(["md","mdx","txt","html","htm","json","yaml","yml","xml","csv","tsv"].includes(ext))return "document";
  if(["docx","pdf","odt"].includes(ext))return "document";
  if(["pptx","odp"].includes(ext))return "presentation";
  if(["xlsx","xls","ods"].includes(ext))return "spreadsheet";
  if(["png","jpg","jpeg","gif","webp","svg"].includes(ext))return "image";
  return "binary";
}
function roleForPath(path:string){
  const lower=path.toLowerCase();
  if(/(^|\/)(test|tests|__tests__|fixtures?|snapshots?)(\/|$)/.test(lower)||/\.(test|spec)\.[^.]+$/.test(lower))return "test-evidence";
  if(/(^|\/)(docs?|examples?|samples?)(\/|$)/.test(lower))return "reference-evidence";
  if(/(^|\/)(package\.json|tsconfig[^/]*|vite\.config\.|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml)/.test(lower))return "configuration";
  if(CODE_EXTS.has(extension(lower)))return "implementation";
  return "content";
}
function inferKind(name:string,mimeType:string,structure:string[]):ArtifactKind{
  const ext=extension(name);
  if(ext==="zip"){
    const code=structure.some((path)=>/(^|\/)(package\.json|src\/|app\/|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml)/i.test(path));
    return code?"codebase":"generic";
  }
  if(["pptx","ppt","odp"].includes(ext))return "presentation";
  if(["xlsx","xls","ods","csv","tsv"].includes(ext))return "spreadsheet";
  if(CODE_EXTS.has(ext))return "codebase";
  if(["json","yaml","yml"].includes(ext)&&/workflow|pipeline|dag|flow/i.test(name))return "workflow";
  if(mimeType.startsWith("image/"))return "image";
  if(mimeType.startsWith("audio/")||mimeType.startsWith("video/"))return "media";
  if(/prompt|instruction|system-prompt/i.test(name))return "prompt";
  if(/knowledge|corpus|kb|知识/i.test(name))return "knowledge";
  if(["pdf","docx","doc","odt","rtf","md","mdx","txt","html","htm"].includes(ext))return "document";
  return "generic";
}

async function parseDocx(buffer:Uint8Array){
  let text="";
  try{text=(await mammoth.extractRawText({buffer:Buffer.from(buffer)})).value;}catch{/* package fallback below */}
  const zip=await JSZip.loadAsync(buffer);
  const paths=["word/document.xml",...Object.keys(zip.files).filter((name)=>/^word\/(footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name))];
  const parts:Array<{path:string;textRuns:Array<{index:number;text:string}>}>=[];
  const chunks:string[]=[];
  for(const path of paths){
    const file=zip.file(path);
    if(!file)continue;
    const xml=await file.async("string");
    const runs=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match,index)=>({index,text:xmlUnescape(match[1]??"")}));
    if(runs.length)parts.push({path,textRuns:runs});
    const part=runs.map((run)=>run.text).join(" ").trim();
    if(part)chunks.push(part);
  }
  text=text.trim()||chunks.join("\n\n");
  return {text,structure:parts.map((part)=>part.path),structuredContent:{kind:"document",subtype:"docx",parts}};
}

async function parsePptx(buffer:Uint8Array){
  const zip=await JSZip.loadAsync(buffer);
  const slides=Object.keys(zip.files).filter((name)=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const rows:Array<{number:number;path:string;textRuns:Array<{index:number;text:string}>}>=[];
  const chunks:string[]=[];
  for(const path of slides){
    const xml=await zip.file(path)!.async("string");
    const textRuns=[...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match,index)=>({index,text:xmlUnescape(match[1]??"")}));
    const number=Number(path.match(/slide(\d+)/)?.[1]??rows.length+1);
    rows.push({number,path,textRuns});
    const text=textRuns.map((run)=>run.text).filter(Boolean).join("\n").trim();
    if(text)chunks.push(`===== SLIDE ${number} =====\n${text}`);
  }
  return {text:chunks.join("\n\n"),structure:slides,structuredContent:{kind:"presentation",slides:rows}};
}

function parseSpreadsheet(buffer:Uint8Array){
  const workbook=XLSX.read(buffer,{type:"array",cellFormula:true,cellStyles:true,cellDates:true,bookVBA:true});
  const sheets=workbook.SheetNames.slice(0,30).map((name)=>{
    const sheet=workbook.Sheets[name];
    const csv=sheet?XLSX.utils.sheet_to_csv(sheet).slice(0,40_000):"";
    const rows=sheet?XLSX.utils.sheet_to_json<Array<string|number|boolean|Date|null>>(sheet,{header:1,defval:null,raw:true}).slice(0,600):[];
    const cells=sheet?Object.entries(sheet).filter(([address])=>!address.startsWith("!")).slice(0,7000).map(([address,cell])=>{
      const value=cell as XLSX.CellObject;
      return {address,value:value.v??null,formula:value.f,type:value.t,format:value.z};
    }):[];
    return {name,csv,rows,cells};
  });
  return {
    text:sheets.map((sheet)=>`===== SHEET: ${sheet.name} =====\n${sheet.csv}`).join("\n\n"),
    structure:workbook.SheetNames,
    structuredContent:{kind:"spreadsheet",sheets},
  };
}

async function parsePdf(buffer:Uint8Array){
  if(!buffer.byteLength||buffer.byteLength>MAX_PDF_FILE_BYTES)throw new Error("PDF 文件超出 Server Native 解析范围");
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task=pdfjs.getDocument({data:buffer,useWorkerFetch:false,stopAtErrors:true,disableFontFace:true});
  try{
    const doc=await task.promise;
    if(!doc.numPages)throw new Error("PDF 没有可解析的页面");
    const chunks:string[]=[];
    const structure:string[]=[];
    const warnings:string[]=[];
    let totalChars=0;
    let parsedPages=0;
    let deepIndexedPages=0;
    for(let index=1;index<=Math.min(doc.numPages,MAX_PDF_PAGES);index+=1){
      const page=await doc.getPage(index);
      try{
        const content=await page.getTextContent();
        if(content.items.length>MAX_PDF_PAGE_ITEMS)throw new Error("PDF 单页文本项超出 Server Native 解析范围");
        const pageText=content.items.map((item)=>"str" in item?item.str:"").join(" ").trim();
        structure.push(`page-${index}`);
        if(!pageText)continue;
        parsedPages+=1;
        const remaining=MAX_PDF_TEXT_CHARS-totalChars;
        const excerpt=pageText.slice(0,remaining);
        if(excerpt)chunks.push(`===== PAGE ${index} =====\n${excerpt}`);
        totalChars+=excerpt.length;
        if(excerpt.length===pageText.length)deepIndexedPages+=1;
        if(totalChars>=MAX_PDF_TEXT_CHARS)break;
      }finally{page.cleanup();}
    }
    if(parsedPages<structure.length)warnings.push("PDF 部分页面没有可提取的文字层；扫描或图片内容需 OCR 扩展。");
    if(structure.length<doc.numPages||deepIndexedPages<parsedPages)warnings.push("PDF 仅建立有界文本预览；未读取的页面或截断内容不计入完整覆盖率。");
    if(!parsedPages)warnings.push("PDF 未找到可提取的文字层；原文件已保留，可连接 OCR 扩展。");
    return {
      text:chunks.join("\n\n"),structure,warnings,
      structuredContent:{kind:"document",subtype:"pdf",pages:doc.numPages,indexedPages:structure.length},
      stats:{totalEntries:doc.numPages,indexedEntries:structure.length,parsedEntries:parsedPages,
        eligibleEntries:doc.numPages,deepIndexedEntries:deepIndexedPages,codeFiles:0,documentFiles:1,officeFiles:0,imageFiles:0},
    };
  }finally{await task.destroy();}
}

async function parseZip(buffer:Uint8Array){
  if(!buffer.byteLength||buffer.byteLength>MAX_ZIP_ARCHIVE_BYTES)throw new Error("ZIP 文件超出 Server Native 解析范围");
  assertServerZipEntryBudget(buffer,MAX_ZIP_FILES);
  const zip=await JSZip.loadAsync(buffer);
  const files=(Object.values(zip.files) as JSZipObject[]).filter((file)=>!file.dir);
  if(!files.length||files.length>MAX_ZIP_FILES)throw new Error("ZIP 文件数量超出 Server Native 解析范围");
  let manifestChars=0;
  for(const file of files){
    const path=file.name;
    const original=(file as JSZipObject&{unsafeOriginalName?:string}).unsafeOriginalName;
    if(!safeServerZipPath(path)||(original&&!safeServerZipPath(original)))throw new Error("ZIP 包含不安全的文件路径");
    manifestChars+=path.length+1;
    if(path.length>1000||manifestChars>MAX_ZIP_MANIFEST_CHARS)throw new Error("ZIP 文件路径索引超出安全范围");
  }
  const manifest=files.map((file)=>file.name);
  const entries:Array<{path:string;family:string;role:string;content?:string;sizeChars?:number}>=[];
  let totalChars=0;
  let totalBytes=0;
  let eligibleEntries=0;
  let omittedEntries=0;
  let truncatedEntries=0;
  for(const file of files){
    if(IGNORED_ZIP_PATH.test(file.name))continue;
    const ext=extension(file.name);
    if(!TEXT_EXTS.has(ext)&&!["package.json","pyproject.toml","go.mod","cargo.toml"].some((name)=>file.name.toLowerCase().endsWith(name)))continue;
    eligibleEntries+=1;
    if(entries.length>=MAX_ZIP_TEXT_FILES||totalChars>=MAX_ZIP_TOTAL_CHARS){omittedEntries+=1;continue;}
    const data=(file as JSZipObject&{_data?:{uncompressedSize?:number;crc32?:number}})._data;
    const size=data?.uncompressedSize;
    if(!Number.isSafeInteger(size)||size!<0||size!>MAX_ZIP_TEXT_ENTRY_BYTES||totalBytes+size!>MAX_ZIP_INDEX_BYTES){
      throw new Error("ZIP 文本条目解压大小超出安全范围");
    }
    totalBytes+=size!;
    const extracted=await file.async("uint8array");
    if(extracted.byteLength!==size||!Number.isInteger(data?.crc32)
      ||serverZipCrc32(extracted)!==(data!.crc32!>>>0))throw new Error("ZIP 文本条目大小或 CRC32 校验失败");
    const raw=new TextDecoder("utf-8",{fatal:true}).decode(extracted);
    const content=raw.slice(0,Math.min(MAX_ZIP_FILE_CHARS,MAX_ZIP_TOTAL_CHARS-totalChars));
    if(content.length<raw.length)truncatedEntries+=1;
    totalChars+=content.length;
    entries.push({path:file.name,family:familyForPath(file.name),role:roleForPath(file.name),content,sizeChars:content.length});
  }
  const inventory=manifest.reduce<Record<string,number>>((acc,path)=>{
    const family=familyForPath(path);acc[family]=(acc[family]??0)+1;return acc;
  },{});
  const digest=entries.slice(0,30).map((entry)=>`===== FILE: ${entry.path} =====\n${entry.content?.slice(0,5000)??""}`).join("\n\n");
  const fullText=`ZIP PACKAGE MANIFEST (${manifest.length} files):\n${manifest.join("\n")}\n\nRETRIEVABLE SEMANTIC DIGEST:\n${digest}`;
  const text=fullText.slice(0,MAX_TEXT_CHARS);
  const warnings:string[]=[];
  if(!eligibleEntries)warnings.push("ZIP 仅识别文件清单，未找到可索引的文本条目。");
  if(omittedEntries||truncatedEntries||entries.length>30||fullText.length>text.length){
    warnings.push("ZIP 仅建立有界文本预览；部分文件或内容未纳入语义摘要，不能据此证明完整代码行为。");
  }
  return {
    text,warnings,structure:manifest,
    structuredContent:{
      kind:"package",manifest,entries,inventory,
      selectedTextFiles:entries.length,selectedTextChars:totalChars,
      semanticPrimaryPaths:entries.filter((entry)=>["implementation","configuration","content"].includes(entry.role)).map((entry)=>entry.path),
      evidenceOnlyPaths:entries.filter((entry)=>["test-evidence","reference-evidence"].includes(entry.role)).map((entry)=>entry.path),
      codeIndex:{files:[],importEdges:[],parseOk:0,parseFailed:0},
      parserPolicy:"bounded server-native text preview; exact stored ZIP evidence indexed separately",
    },
    stats:{
      totalEntries:manifest.length,indexedEntries:manifest.length,parsedEntries:entries.length,
      eligibleEntries,deepIndexedEntries:entries.length-truncatedEntries,
      codeFiles:inventory.code??0,documentFiles:inventory.document??0,
      officeFiles:(inventory.presentation??0)+(inventory.spreadsheet??0),imageFiles:inventory.image??0,
    },
  };
}
export async function parseServerSource(args:{
  artifactId:string;
  name:string;
  mimeType:string;
  size:number;
  role:ArtifactRole;
  blob:Blob;
  storageRef:string;
}):Promise<SourceArtifact>{
  const buffer=new Uint8Array(await args.blob.arrayBuffer());
  const ext=extension(args.name);
  const warnings:string[]=[];
  let text="";
  let structure:string[]=[];
  let structuredContent:unknown;
  let stats={totalEntries:0,indexedEntries:0,parsedEntries:0,eligibleEntries:0,deepIndexedEntries:0,codeFiles:0,documentFiles:0,officeFiles:0,imageFiles:0};
  try{
    if(ext==="docx"){
      ({text,structure,structuredContent}=await parseDocx(buffer));
    }else if(ext==="pptx"){
      ({text,structure,structuredContent}=await parsePptx(buffer));
    }else if(["xlsx","xls"].includes(ext)){
      ({text,structure,structuredContent}=parseSpreadsheet(buffer));
    }else if(["odt","ods","odp"].includes(ext)){
      ({text,structure,structuredContent}=await parseOpenDocument(buffer,ext));
    }else if(ext==="rtf"){
      ({text,structure,structuredContent}=parseRtf(buffer));
      warnings.push("RTF 已按文本近似抽取；样式信息不作为结构化证据。");
    }else if(ext==="pdf"){
      const parsed=await parsePdf(buffer);
      ({text,structure,structuredContent}=parsed);stats=parsed.stats;warnings.push(...parsed.warnings);
    }else if(ext==="zip"){
      const parsed=await parseZip(buffer);
      ({text,structure,structuredContent}=parsed);stats=parsed.stats;warnings.push(...parsed.warnings);
    }else{
      const decoded=decode(buffer);
      if(TEXT_EXTS.has(ext)||args.mimeType.startsWith("text/")||!binaryLike(decoded)){
        text=decoded.slice(0,MAX_TEXT_CHARS);
        if(ext==="json"){
          try{structuredContent={kind:"json",value:JSON.parse(decoded)};}catch{warnings.push("JSON 文本无法完整解析为结构化对象，已保留原文。");}
        }
      }else{
        warnings.push("当前 Server Native Parser 未识别该二进制格式；原文件已安全保留，可连接外部 Parser 扩展。");
      }
    }
  }catch(error){
    warnings.push(`Server Native Parser 部分解析失败：${error instanceof Error?error.message:String(error)}`);
  }
  const artifactKind=inferKind(args.name,args.mimeType,structure);
  const parseStatus=args.mimeType.startsWith("image/")?"image":text?"ready":warnings.length?"unsupported":"binary";
  const artifactDescriptor=describeArtifact({
    name:args.name,mimeType:args.mimeType,extension:ext,artifactKind,structure,structuredContent,
  });
  const bounded=ext==="zip"||ext==="pdf";
  const parsedEntries=bounded?stats.parsedEntries:stats.parsedEntries||(text?1:0);
  const totalEntries=bounded?stats.totalEntries:stats.totalEntries||(text?1:0);
  const eligibleEntries=bounded?stats.eligibleEntries:stats.eligibleEntries||parsedEntries;
  const deepIndexedEntries=bounded?stats.deepIndexedEntries:stats.deepIndexedEntries||parsedEntries;
  const deepIndexCoverage=eligibleEntries?Math.min(1,deepIndexedEntries/eligibleEntries):0;
  const now=new Date().toISOString();
  return SourceArtifactSchema.parse({
    id:args.artifactId,
    name:args.name,
    role:args.role,
    artifactKind,
    artifactDescriptor,
    mimeType:args.mimeType,
    size:args.size,
    extension:ext,
    inputMode:"upload",
    parseStatus,
    textContent:text||undefined,
    textExcerpt:text?text.slice(0,2800):`[附件] ${args.name}`,
    storageRef:args.storageRef,
    structure,
    structuredContent,
    parsingProfile:{
      engine:"server-native",
      engineLabel:"Server Native Parser",
      confidence:text?0.9:0.45,
      completeness:bounded?deepIndexCoverage:text?Math.min(1,Math.max(0.55,parsedEntries/Math.max(1,totalEntries))):0.15,
      structuralCoverage:structure.length?Math.min(1,structure.length/Math.max(1,totalEntries)):text?0.8:0.15,
      totalEntries,
      indexedEntries:stats.indexedEntries||structure.length||(text?1:0),
      parsedEntries,
      eligibleEntries,
      deepIndexedEntries,
      deepIndexCoverage,
      codeFiles:stats.codeFiles,
      documentFiles:stats.documentFiles,
      officeFiles:stats.officeFiles,
      imageFiles:stats.imageFiles,
      contextWindowChars:text.length,
      executableEvidence:false,
      visualEvidence:false,
      limitations:warnings,
      recommendations:parseStatus==="unsupported"?["如需更深层二进制语义解析，请配置 Server Parser Plugin（Docling/Unstructured/Tika）。"]:[],
      generatedAt:now,
    },
    warnings,
    createdAt:now,
  });
}

export const SERVER_SOURCE_PARSE_EXTENSIONS=[
  "txt","md","mdx","html","htm","json","yaml","yml","xml","csv","tsv",
  "js","jsx","ts","tsx","mjs","cjs","py","go","rs","java","kt","php","sql","vue","svelte",
  "docx","pptx","xlsx","xls","odt","ods","odp","rtf","pdf","zip",
];
