import JSZip, {type JSZipObject} from "jszip";
import * as XLSX from "xlsx";
import type {CandidateArtifactSnapshot,SourceArtifact} from "@evolution/contracts";
import {SpreadsheetOverlaySchema,validateStructuredTextFormat} from "@evolution/adapters";
import {isStructuredTextArtifactExtension} from "@evolution/core";
import {assertServerZipEntryBudget,safeServerZipPath} from "./server-codebase-zip-index";

const NATIVE=new Set(["docx","pptx","xlsx","xls","ods","csv","tsv","zip","json","jsonl"]);
const MAX_ARCHIVE=25_000_000;
export function hasServerNativeRoundtrip(ext:string){return NATIVE.has(ext.toLowerCase())||isStructuredTextArtifactExtension(ext);}
function blueprint(snapshot?:CandidateArtifactSnapshot){
  if(!snapshot)return undefined;
  let input:unknown;
  try{input=JSON.parse(snapshot.content);}catch{throw Error("原生 Candidate Snapshot 不是 JSON 修改指令");}
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("原生 Candidate 修改指令无效");
  const obj=input as Record<string,unknown>;
  if(obj.kind==="keep-parent"){
    if(obj.sourceArtifactId!==snapshot.sourceArtifactId||Object.keys(obj).some(k=>k!=="kind"&&k!=="sourceArtifactId"))
      throw Error("keep-parent 与 Source 身份不匹配");
    return undefined;
  }
  return obj;
}
function xmlUnescape(value:string){return value.replace(/&lt;/g,"<").replace(/&gt;/g,">")
  .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");}
function assertXmlRuns(xml:string,tag:"w:t"|"a:t",updates:unknown){
  if(!Array.isArray(updates)||!updates.length)throw Error("未提供 OOXML 修改位置");
  const regex=tag==="w:t"?/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g:/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  const values=[...xml.matchAll(regex)].map(m=>xmlUnescape(m[1]??""));
  const seen=new Set<number>();
  for(const [position,item] of updates.entries()){
    const update=typeof item==="string"?{index:position,text:item}:item as {index?:unknown;text?:unknown};
    const index=update?.index;
    if(!Number.isInteger(index)||Number(index)<0||seen.has(Number(index))
       ||typeof update.text!=="string"||values[Number(index)]!==update.text){
      throw Error("冻结 OOXML 文本位置与 Candidate 指令不一致");
    }
    seen.add(Number(index));
  }
}
async function openArchive(bytes:Uint8Array){
  assertServerZipEntryBudget(bytes);
  const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
  const files=(Object.values(zip.files) as JSZipObject[]).filter(f=>!f.dir);
  if(!files.length||files.length>2000)throw Error("ZIP 无文件或超出安全范围");
  let total=0;
  for(const f of files){
    const original=(f as JSZipObject & {unsafeOriginalName?:string}).unsafeOriginalName;
    if(!safeServerZipPath(f.name)||(original&&!safeServerZipPath(original)))throw Error("ZIP 文件路径不安全");
    const size=(f as JSZipObject & {_data?:{uncompressedSize?:number}})._data?.uncompressedSize;
    if(!Number.isSafeInteger(size)||size!<0||size!>20_000_000||(total+=size!)>75_000_000)
      throw Error("ZIP 条目或总解压量超出上限");
  }
  return {zip,files};
}
async function office(ext:"docx"|"pptx",bytes:Uint8Array,plan?:Record<string,unknown>){
  const {zip,files}=await openArchive(bytes);
  if(!zip.file("[Content_Types].xml")||!zip.file("_rels/.rels"))
    throw Error(ext.toUpperCase()+" 缺少 Office 内容类型或关系清单");
  if(ext==="docx"){
    const main=zip.file("word/document.xml");
    if(!main)throw Error("DOCX 正文缺失");
    const xml=await main.async("string");
    if(!/<w:document(?:\s|>)/.test(xml)||!/<\/w:document>/.test(xml))throw Error("DOCX 正文 XML 不完整");
    if(plan){
      const parts=plan.parts as Array<{path:string;textRuns:unknown}>|undefined;
      if(!Array.isArray(parts)||!parts.length)throw Error("DOCX Candidate 缺少修改部件");
      const seen=new Set<string>();
      for(const part of parts){
        if(typeof part.path!=="string"||seen.has(part.path)
          ||!/^word\/(?:document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(part.path))
          throw Error("DOCX 部件重复或不允许修改");
        seen.add(part.path);
        const file=zip.file(part.path);
        if(!file)throw Error("DOCX 冻结文件缺少目标部件");
        assertXmlRuns(await file.async("string"),"w:t",part.textRuns);
      }
    }
  }else{
    const main=zip.file("ppt/presentation.xml");
    const slides=files.filter(f=>/^ppt\/slides\/slide\d+\.xml$/.test(f.name));
    if(!main||!slides.length)throw Error("PPTX 演示索引/幻灯片缺失");
    const xml=await main.async("string");
    if(!/<p:presentation(?:\s|>)/.test(xml)||!/<\/p:presentation>/.test(xml))
      throw Error("PPTX 演示索引 XML 不完整");
    for(const slide of slides){
      const part=await slide.async("string");
      if(!/<p:sld(?:\s|>)/.test(part)||!/<\/p:sld>/.test(part))throw Error("PPTX 幻灯片 XML 不完整");
    }
    if(plan){
      const updates=plan.slides as Array<{number:number;textRuns:unknown}>|undefined;
      if(!Array.isArray(updates)||!updates.length)throw Error("PPTX Candidate 缺少修改页码");
      const seen=new Set<number>();
      for(const item of updates){
        if(!Number.isSafeInteger(item.number)||item.number<1||seen.has(item.number))throw Error("PPTX 页码重复/无效");
        seen.add(item.number);
        const slide=zip.file("ppt/slides/slide"+item.number+".xml");
        if(!slide)throw Error("PPTX 冻结文件缺少指定幻灯片");
        assertXmlRuns(await slide.async("string"),"a:t",item.textRuns);
      }
    }
  }
  return ext.toUpperCase()+" 完成 ZIP CRC、基础 OOXML 结构和指定文本位置回读（不含视觉排版验证）";
}
function sheet(ext:"xlsx"|"xls"|"ods"|"csv"|"tsv",bytes:Uint8Array,plan?:Record<string,unknown>){
  const delimited=ext==="csv"||ext==="tsv";
  let text:string|undefined;
  if(delimited){
    text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    const reencoded=new TextEncoder().encode(text);
    if(text.includes("\0")||reencoded.byteLength!==bytes.byteLength||reencoded.some((b,i)=>b!==bytes[i]))
      throw Error("CSV/TSV 字节或编码错误");
  }
  const workbook=delimited
    ?XLSX.read(text!,{type:"string",raw:true,FS:ext==="tsv"?"\t":","})
    :XLSX.read(bytes,{type:"array",cellFormula:true,cellDates:true});
  if(!workbook.SheetNames.length||!workbook.SheetNames.every(name=>Boolean(workbook.Sheets[name])))
    throw Error("表格未找到可用工作表");
  if(plan){
    const patch=SpreadsheetOverlaySchema.safeParse(plan);
    if(!patch.success)throw Error("表格 Candidate 缺少有效 Sheet/Cell 指令");
    for(const item of patch.data.sheets){
      const ws=workbook.Sheets[item.name];
      if(!ws)throw Error("表格缺少 Candidate 指定 Sheet");
      for(const cell of item.cells){
        const value=ws[cell.address] as XLSX.CellObject|undefined;
        if(cell.formula!==undefined){
          if(delimited||value?.f!==cell.formula)throw Error("表格公式未按要求写入");
        }else if(cell.value!==undefined){
          const expected=cell.value===null?"":cell.value;
          const actual=value?.v??"";
          if(delimited?String(actual)!==String(expected):actual!==expected)
            throw Error("表格单元格与 Candidate 值不一致");
        }
      }
    }
  }
  return delimited?ext.toUpperCase()+" 编码与全表 Sheet/A1 可解析，目标单元格回读一致"
    :ext.toUpperCase()+" 工作簿与目标单元格/公式可解析（未验证公式重算或图表）";
}
/** Verify native format structure from actual bytes; SHA-bound identity is verified separately by the caller. */
export async function inspectServerNativeFormat(args:{source:SourceArtifact;bytes:Uint8Array;snapshot?:CandidateArtifactSnapshot}):Promise<string>{
  const ext=args.source.extension.toLowerCase();
  if(!hasServerNativeRoundtrip(ext))throw Error("此类型未配置原生格式往返验证器");
  if(!args.bytes.length||args.bytes.byteLength>MAX_ARCHIVE)throw Error("原生格式文件超出验证预算");
  if(args.snapshot&&args.snapshot.sourceArtifactId!==args.source.id)throw Error("Snapshot 与 Target 身份不一致");
  if(isStructuredTextArtifactExtension(ext)){
    const text=new TextDecoder("utf-8",{fatal:true}).decode(args.bytes);
    if(args.snapshot&&args.snapshot.content!==text)throw Error("JSON 文件字节与 Candidate Snapshot 不一致");
    return ext.toUpperCase()+" UTF-8 字节与 "+validateStructuredTextFormat({extension:ext,content:text});
  }
  const plan=blueprint(args.snapshot);
  if(ext==="docx"||ext==="pptx")return office(ext,args.bytes,plan);
  if(ext==="zip"){
    const {zip,files}=await openArchive(args.bytes);
    if(plan){
      const edits=plan.files as Array<{path:string;content:string}>|undefined;
      if(!Array.isArray(edits)||!edits.length)throw Error("ZIP Candidate 缺少有效修改文件");
      for(const file of edits){
        if(typeof file.path!=="string"||!safeServerZipPath(file.path)||typeof file.content!=="string"
          ||await zip.file(file.path)?.async("string")!==file.content)
          throw Error("ZIP 冻结文件内容与 Candidate 变更不一致");
      }
    }
    return "ZIP 全部 CRC、安全路径及中央目录通过，共 "+files.length+" 个文件（不代表代码执行）";
  }
  if(ext==="xlsx"){
    const {zip}=await openArchive(args.bytes);
    if(!zip.file("[Content_Types].xml")||!zip.file("xl/workbook.xml"))
      throw Error("XLSX 工作簿缺少必需 OOXML 部件");
    return sheet("xlsx",args.bytes,plan);
  }
  if(ext==="xls"){
    const magic=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
    if(!magic.every((byte,index)=>args.bytes[index]===byte))throw Error("XLS 缺少原生 OLE 文件头");
    return sheet("xls",args.bytes,plan);
  }
  if(ext==="ods"){
    const {zip}=await openArchive(args.bytes);
    if(await zip.file("mimetype")?.async("string")!=="application/vnd.oasis.opendocument.spreadsheet")throw Error("ODS 文件类型声明无效");
    const xml=await zip.file("content.xml")?.async("string");
    if(!xml)throw Error("ODS 缺少 content.xml");
    validateStructuredTextFormat({extension:"xml",content:xml});
    return sheet("ods",args.bytes,plan);
  }
  return sheet(ext as "csv"|"tsv",args.bytes,plan);
}
