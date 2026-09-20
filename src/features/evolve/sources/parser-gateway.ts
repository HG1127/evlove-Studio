import type { ParsingProfile } from "../schemas";

export type ParserServiceKind = "docling" | "unstructured" | "tika" | "custom";
export type ParserGatewayKind = "off" | "auto" | ParserServiceKind;
export type ParserServiceConfig = {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
};
export type ParserGatewayConfig = {
  enabled: boolean;
  kind: ParserGatewayKind;
  /** Legacy/single-parser fields kept for backwards compatibility. */
  endpoint: string;
  apiKey?: string;
  timeoutMs: number;
  preferFor: string[];
  services: Record<ParserServiceKind, ParserServiceConfig>;
};
export type ExternalParseResult = {
  text?: string;
  structuredContent?: unknown;
  structure?: string[];
  profile?: Partial<ParsingProfile>;
  warnings: string[];
};

const KEY = "evolve-studio:parser-gateway:v2";
const LEGACY_KEY = "evolve-studio:parser-gateway:v1";
const serviceDefaults: Record<ParserServiceKind, ParserServiceConfig> = {
  docling: { enabled:false, endpoint:"http://localhost:5001/v1/convert/file", timeoutMs:120000 },
  unstructured: { enabled:false, endpoint:"https://api.unstructuredapp.io/general/v0/general", timeoutMs:120000 },
  tika: { enabled:false, endpoint:"http://localhost:9998", timeoutMs:90000 },
  custom: { enabled:false, endpoint:"", timeoutMs:90000 },
};
const DEFAULT: ParserGatewayConfig = { enabled:false, kind:"off", endpoint:"", timeoutMs:90000, preferFor:["pdf","docx","pptx","xlsx","image"], services:serviceDefaults };

function cloneDefaults() {
  return { ...DEFAULT, services: Object.fromEntries(Object.entries(serviceDefaults).map(([key,value])=>[key,{...value}])) as Record<ParserServiceKind,ParserServiceConfig> };
}
function mergeConfig(value: Partial<ParserGatewayConfig>): ParserGatewayConfig {
  const base=cloneDefaults();
  const services={...base.services};
  for(const kind of Object.keys(services) as ParserServiceKind[]) services[kind]={...services[kind],...(value.services?.[kind]??{})};
  return {...base,...value,services};
}
export function getParserGatewayConfig(): ParserGatewayConfig {
  if (typeof window === "undefined") return cloneDefaults();
  try {
    const raw=window.localStorage.getItem(KEY);
    if(raw) return mergeConfig(JSON.parse(raw) as Partial<ParserGatewayConfig>);
    const legacyRaw=window.localStorage.getItem(LEGACY_KEY);
    if(!legacyRaw) return cloneDefaults();
    const legacy=JSON.parse(legacyRaw) as Partial<ParserGatewayConfig>;
    const merged=mergeConfig(legacy);
    if(legacy.kind && legacy.kind!=="off" && legacy.kind!=="auto") merged.services[legacy.kind]={enabled:Boolean(legacy.enabled),endpoint:legacy.endpoint||merged.services[legacy.kind].endpoint,apiKey:legacy.apiKey,timeoutMs:legacy.timeoutMs||merged.services[legacy.kind].timeoutMs};
    return merged;
  } catch { return cloneDefaults(); }
}
export function saveParserGatewayConfig(config: ParserGatewayConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent("evolve-parser-gateway-changed"));
}

function ext(name: string) { return name.split(".").pop()?.toLowerCase() ?? ""; }
function timeout(ms: number) { return AbortSignal.timeout(Math.max(1000, ms)); }
function doclingText(json: unknown) {
  const value = json as Record<string, unknown>;
  const doc = value.document as Record<string, unknown> | undefined;
  const candidates = [value.md_content, value.text_content, value.markdown, value.text, doc?.markdown, doc?.text];
  return candidates.find((item): item is string => typeof item === "string" && item.trim().length > 0);
}
function unstructuredText(json: unknown) {
  if (!Array.isArray(json)) return undefined;
  return json.map((item) => typeof (item as Record<string, unknown>)?.text === "string" ? String((item as Record<string, unknown>).text) : "").filter(Boolean).join("\n\n");
}
function serviceHeaders(kind:ParserServiceKind, apiKey?:string){
  const headers:Record<string,string>={};
  if(!apiKey) return headers;
  if(kind==="unstructured") headers["unstructured-api-key"]=apiKey;
  else if(kind==="docling") headers["X-Api-Key"]=apiKey;
  else headers.Authorization=`Bearer ${apiKey}`;
  return headers;
}
function isLocalPreferred(name:string,mime:string){
  const extension=ext(name);
  if(extension==="zip") return true;
  if(["ts","tsx","js","jsx","mjs","cjs","py","go","java","rs","vue","svelte","json","yaml","yml","md","txt","csv","tsv"].includes(extension)) return true;
  return mime.startsWith("text/");
}
function autoCandidates(name:string,mime:string):ParserServiceKind[]{
  const extension=ext(name);
  if(isLocalPreferred(name,mime)) return [];
  if(extension==="pdf") return ["docling","unstructured","tika","custom"];
  if(["docx","doc","pptx","ppt","xlsx","xls","odt","ods","odp"].includes(extension)) return ["docling","unstructured","tika","custom"];
  if(mime.startsWith("image/")||["png","jpg","jpeg","webp","tiff","bmp","heic"].includes(extension)) return ["unstructured","custom","tika"];
  return ["tika","custom","docling","unstructured"];
}

async function parseWithService(args:{kind:ParserServiceKind;config:ParserServiceConfig;name:string;mimeType:string;buffer:Uint8Array}):Promise<ExternalParseResult>{
  const {kind,config}=args;
  const blob=new Blob([args.buffer as BlobPart],{type:args.mimeType||"application/octet-stream"});
  const file=new File([blob],args.name,{type:args.mimeType||"application/octet-stream"});
  const headers=serviceHeaders(kind,config.apiKey);
  if(kind==="tika"){
    const endpoint=config.endpoint.replace(/\/$/,"")+(config.endpoint.replace(/\/$/,"").endsWith("/tika")?"":"/tika");
    const response=await fetch(endpoint,{method:"PUT",headers:{...headers,Accept:"text/plain","Content-Type":args.mimeType||"application/octet-stream"},body:blob,signal:timeout(config.timeoutMs)});
    if(!response.ok) throw new Error(`Tika ${response.status}`);
    const text=await response.text();
    return {text,warnings:[],profile:{engine:"tika",engineLabel:"Apache Tika",confidence:text.trim()?0.88:0.4,completeness:text.trim()?0.82:0.2,structuralCoverage:0.55}};
  }
  const form=new FormData();
  if(kind==="docling"){
    form.append("files",file); form.append("to_formats","md"); form.append("to_formats","json"); form.append("do_ocr","true");
  } else if(kind==="unstructured"){
    form.append("files",file); form.append("strategy","auto"); form.append("infer_table_structure","true");
  } else form.append("file",file);
  const response=await fetch(config.endpoint,{method:"POST",headers,body:form,signal:timeout(config.timeoutMs)});
  if(!response.ok) throw new Error(`${kind} ${response.status}`);
  const json=await response.json();
  const text=kind==="docling"?doclingText(json):kind==="unstructured"?unstructuredText(json):doclingText(json)??unstructuredText(json);
  return {text,structuredContent:json,warnings:[],profile:{engine:kind==="docling"?"docling":kind==="unstructured"?"unstructured":"hybrid",engineLabel:kind==="docling"?"Docling":kind==="unstructured"?"Unstructured":"External Parser",confidence:text?.trim()?0.94:0.45,completeness:text?.trim()?0.92:0.3,structuralCoverage:kind==="docling"||kind==="unstructured"?0.9:0.7}};
}

function activeService(config:ParserGatewayConfig,kind:ParserServiceKind):ParserServiceConfig|undefined{
  const service=config.services[kind];
  if(config.kind===kind && config.endpoint.trim()) return {enabled:true,endpoint:config.endpoint,apiKey:config.apiKey,timeoutMs:config.timeoutMs};
  return service?.enabled&&service.endpoint.trim()?service:undefined;
}

export function parserRoutePlan(name:string,mimeType:string,config:ParserGatewayConfig=getParserGatewayConfig()){
  if(!config.enabled||config.kind==="off"||isLocalPreferred(name,mimeType)) return [] as ParserServiceKind[];
  const candidates=config.kind==="auto"?autoCandidates(name,mimeType):[config.kind as ParserServiceKind];
  return candidates.filter((kind)=>Boolean(activeService(config,kind)));
}

export async function parseWithExternalGateway(args: { name: string; mimeType: string; buffer: Uint8Array }, configOverride?: ParserGatewayConfig): Promise<ExternalParseResult | undefined> {
  const config=configOverride ?? getParserGatewayConfig();
  if(!config.enabled||config.kind==="off"||isLocalPreferred(args.name,args.mimeType)) return undefined;
  const candidates=parserRoutePlan(args.name,args.mimeType,config);
  const warnings:string[]=[];
  for(const kind of candidates){
    const service=activeService(config,kind);
    if(!service) continue;
    try{
      const result=await parseWithService({kind,config:service,...args});
      return {...result,warnings:[...warnings,...result.warnings,`Parser Router：${kind} 成功解析 ${args.name}`]};
    }catch(error){warnings.push(`${kind} 解析失败：${error instanceof Error?error.message:String(error)}`);}
  }
  return warnings.length?{warnings:[...warnings,"外部 Parser Router 未取得有效结果，已回退浏览器本地解析。"]}:undefined;
}

export async function testParserService(kind:ParserServiceKind, service:ParserServiceConfig){
  const started=Date.now();
  if(!service.endpoint.trim()) return {ok:false,latencyMs:0,message:"Endpoint 为空"};
  try{
    const text="Evolve Studio parser connection test. 中文解析连接测试。";
    const result=await parseWithService({kind,config:{...service,enabled:true},name:"evolve-parser-test.txt",mimeType:"text/plain",buffer:new TextEncoder().encode(text)});
    const ok=Boolean(result.text?.trim());
    return {ok,latencyMs:Date.now()-started,message:ok?`${kind} 连接成功，已返回解析文本。`:`${kind} 已响应，但没有返回可读文本。`};
  }catch(error){return {ok:false,latencyMs:Date.now()-started,message:error instanceof Error?error.message:String(error)};}
}
