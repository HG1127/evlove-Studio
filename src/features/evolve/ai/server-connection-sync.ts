import {
  ServerAiConnectionPutSchema,ServerAiConnectionSettingsSchema,ServerAiConnectionStatusSchema,
  type ServerAiConnectionPut,type ServerAiConnectionSettings,type ServerAiConnectionStatus,
} from "@evolution/contracts";
import {getPreset,normalizeBaseUrl} from "./providers/byok";
import type {ProviderConnection} from "./providers/registry";
import {readServerAiConnection,saveServerAiConnection} from "./server-connection-client";

function sameTarget(connection:ProviderConnection,saved:ServerAiConnectionSettings):boolean{
  const preset=getPreset(connection.providerId);
  return connection.id.trim()===saved.connectionId&&connection.defaultModel.trim()===saved.model
    &&normalizeBaseUrl(connection.baseUrl?.trim()||preset.defaultBaseUrl)===normalizeBaseUrl(saved.baseUrl);
}

/** Preserve proven protocol/format only for the exact saved connection, endpoint and model. */
export function buildServerAiConnectionInput(connection:ProviderConnection,current?:ServerAiConnectionSettings):ServerAiConnectionPut{
  if(!connection.enabled)throw new Error("请先启用该连接，再同步到后端。");
  const preset=getPreset(connection.providerId);
  if(preset.kind!=="openai")throw new Error("该供应商尚不支持后端 OpenAI 兼容连接，请先使用兼容接口地址。");
  const keep=current&&sameTarget(connection,current)?current:undefined;
  const parsed=ServerAiConnectionPutSchema.safeParse({
    connectionId:connection.id,label:connection.label,apiKey:connection.apiKey,
    baseUrl:normalizeBaseUrl(connection.baseUrl?.trim()||preset.defaultBaseUrl),model:connection.defaultModel,
    protocol:keep?.protocol??(preset.responsesFirst?"responses":"chat-completions"),
    responseFormat:keep?.responseFormat??"json-object",
  });
  // Do not propagate validation input or upstream errors that could contain credentials.
  if(!parsed.success)throw new Error("模型连接信息不完整，无法同步到后端；请检查连接名称、地址和所选模型。");
  return parsed.data;
}

interface GenerationSyncPorts{
  read:(role:"generation")=>Promise<ServerAiConnectionStatus>;
  save:(input:ServerAiConnectionPut,role:"generation")=>Promise<ServerAiConnectionStatus>;
}
interface GenerationSyncOptions{
  confirmReplacement?:(current:ServerAiConnectionSettings,next:ServerAiConnectionSettings)=>boolean|Promise<boolean>;
}
const defaultPorts:GenerationSyncPorts={read:readServerAiConnection,save:saveServerAiConnection};
const publicFields=["connectionId","label","baseUrl","model","protocol","responseFormat"] as const;

/** One explicit user save: fresh GET -> existing governed PUT/readback. Never write the Judge role. */
export async function synchronizeGenerationConnection(
  connection:ProviderConnection,options:GenerationSyncOptions={},ports:GenerationSyncPorts=defaultPorts,
):Promise<ServerAiConnectionStatus>{
  const snapshot={...connection};
  buildServerAiConnectionInput(snapshot); // Validate locally before any request.
  let current:ServerAiConnectionStatus;
  try{current=ServerAiConnectionStatusSchema.parse(await ports.read("generation"));}
  catch{throw new Error("无法读取后端生成模型的最新配置；未发送保存请求，请检查工作区连接。");}
  if(!current.storageConfigured)throw new Error("后端加密存储尚未启用；未发送保存请求。");
  if(current.configured&&(!current.connection||current.revision===undefined)){
    throw new Error("后端已配置状态不完整；未发送保存请求，不能用默认参数覆盖已有连接。");
  }
  const payload=buildServerAiConnectionInput(snapshot,current.configured?current.connection:undefined);
  if(current.configured&&current.connection&&!sameTarget(snapshot,current.connection)){
    const publicNext=ServerAiConnectionSettingsSchema.parse(payload);
    const confirmed=await options.confirmReplacement?.(current.connection,publicNext);
    if(!confirmed)throw new Error("未确认切换后端生成模型；已有后端连接保持不变。");
  }
  let saved:ServerAiConnectionStatus;
  try{saved=ServerAiConnectionStatusSchema.parse(await ports.save(payload,"generation"));}
  catch{throw new Error("后端同步未确认；保存请求可能已经提交，请先检查后端状态，暂不要重复保存。");}
  if(!saved.storageConfigured||!saved.configured||saved.revision===undefined||!saved.connection
    ||publicFields.some(field=>saved.connection![field]!==payload[field])){
    throw new Error("后端回读与本次配置不一致；请先检查状态，不能认定同步成功。");
  }
  return saved;
}

export interface GenerationConnectionDisplay{
  state:"loading"|"saving"|"error"|"unavailable"|"unconfigured"|"different"|"changed"|"matched";
  tone:"slate"|"amber"|"rose"|"green";
  message:string;
}

/** Public metadata agreement is not proof of credential equality or a fresh runtime probe. */
export function getGenerationConnectionDisplay(
  connection:ProviderConnection|undefined,status:ServerAiConnectionStatus|undefined,
  options:{error?:string;saving?:boolean;dirty?:boolean}={},
):GenerationConnectionDisplay{
  if(options.saving)return {state:"saving",tone:"slate",message:"正在保存并核对后端配置…"};
  if(options.error)return {state:"error",tone:"rose",message:"后端同步或状态读取未确认，请检查后再重试"};
  if(!status)return {state:"loading",tone:"slate",message:"正在读取后端状态…"};
  if(!status.storageConfigured)return {state:"unavailable",tone:"amber",message:"后端加密存储尚未就绪"};
  if(!status.configured)return {state:"unconfigured",tone:"amber",message:"尚未配置后端生成模型"};
  if(!status.connection||status.revision===undefined)return {state:"error",tone:"rose",message:"后端配置状态不完整，尚未确认"};
  if(!connection||!sameTarget(connection,status.connection)){
    return {state:"different",tone:"amber",message:"后端当前使用其他连接或模型："+status.connection.label+" · "+status.connection.model};
  }
  if(!connection.enabled||options.dirty||connection.label.trim()!==status.connection.label){
    return {state:"changed",tone:"amber",message:"本地连接已有变更，尚未确认同步到后端"};
  }
  return {state:"matched",tone:"green",message:"配置一致 · "+status.connection.model+" · "+status.connection.responseFormat+"（非实时连通性验证）"};
}
