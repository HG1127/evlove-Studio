import {AsyncLocalStorage} from "node:async_hooks";
import {
  ServerAiConnectionPutSchema,ServerAiConnectionSettingsSchema,ServerAiConnectionStatusSchema,
  ServerAiStoredConnectionSchema,type EvolutionActor,type ServerAiConnectionPut,
} from "@evolution/contracts";
import {getServerAiConfig,serverAiConfigured,vaultEncryptionConfigured,type ServerAiConfig} from "../server-env";
import {getVaultSecretMetadata,putVaultSecret,resolveVaultSecret} from "./server-vault";

const VAULT_ID="server-ai-default-connection-v1";
const VAULT_SCOPE="ai:default-connection";
const activeConfig=new AsyncLocalStorage<{config:ServerAiConfig|undefined}>();

function parseStoredConnection(raw:string){
  try{return ServerAiStoredConnectionSchema.parse(JSON.parse(raw));}
  catch{
    throw Object.assign(new Error("已保存的后端模型配置无效，请重新保存连接。"),{code:"SERVER_AI_CONNECTION_INVALID"});
  }
}

function normalizeBaseUrl(raw:string){
  return raw.replace(/\/+$/,"").replace(/\/(?:responses|chat\/completions)$/i,"");
}

export function assertServerAiEndpoint(baseUrl:string){
  const url=new URL(baseUrl);
  if(process.env.NODE_ENV==="production"&&url.protocol!=="https:"){
    throw new Error("后端模型在生产环境必须使用 HTTPS API 地址。");
  }
}

function directConfig(input:ServerAiConnectionPut):ServerAiConfig{
  assertServerAiEndpoint(input.baseUrl);
  return {
    mode:"openai-compatible",apiKey:input.apiKey,baseUrl:normalizeBaseUrl(input.baseUrl),
    model:input.model,timeoutMs:getServerAiConfig()?.timeoutMs??90_000,protocol:input.protocol,responseFormat:input.responseFormat,
  };
}

export async function getServerAiConnectionStatus(){
  if(!vaultEncryptionConfigured())return ServerAiConnectionStatusSchema.parse({
    storageConfigured:false,configured:false,message:"后端模型加密保存尚未启用；当前仍可测试所选模型。服务端配置完成后，请重新检查保存状态。",
  });
  const metadata=await getVaultSecretMetadata(VAULT_ID);
  if(!metadata)return ServerAiConnectionStatusSchema.parse({
    storageConfigured:true,configured:false,message:"尚未选择后端默认模型。",
  });
  const stored=parseStoredConnection(await resolveVaultSecret(VAULT_ID,VAULT_SCOPE));
  return ServerAiConnectionStatusSchema.parse({
    storageConfigured:true,configured:true,connection:ServerAiConnectionSettingsSchema.parse(stored),
    revision:metadata.version,message:"后端任务直接使用此模型连接。",
  });
}

export async function saveServerAiConnection(raw:ServerAiConnectionPut,actor:Pick<EvolutionActor,"id"|"role">){
  const input=ServerAiConnectionPutSchema.parse(raw);
  const config=directConfig(input);
  const stored=ServerAiStoredConnectionSchema.parse({
    ...input,baseUrl:config.mode==="openai-compatible"?config.baseUrl:input.baseUrl,
    version:"server-ai-connection-v1",
  });
  const result=await putVaultSecret({
    id:VAULT_ID,name:"后端默认模型",purpose:"User-selected direct AI provider connection",
    scopes:[VAULT_SCOPE],value:JSON.stringify(stored),
  },actor);
  return ServerAiConnectionStatusSchema.parse({
    storageConfigured:true,configured:true,connection:ServerAiConnectionSettingsSchema.parse(stored),
    revision:result.metadata.version,message:"已保存后端模型；后台任务将直接调用这个接口。",
  });
}

/** A saved user connection wins over environment defaults, including a legacy Gateway flag. */
export async function resolveServerAiConfig():Promise<ServerAiConfig|undefined>{
  const active=activeConfig.getStore();
  if(active)return active.config;
  if(vaultEncryptionConfigured()){
    try{
      const stored=await resolveVaultSecret(VAULT_ID,VAULT_SCOPE);
      return directConfig(parseStoredConnection(stored));
    }catch(error){
      if((error as {code?:string}).code!=="VAULT_SECRET_NOT_FOUND")throw error;
    }
  }
  return getServerAiConfig();
}

export async function serverAiConnectionConfigured(){
  return vaultEncryptionConfigured()?Boolean(await resolveServerAiConfig()):serverAiConfigured();
}

/** Pins one route across scoring fingerprints and paired current/Candidate evaluation. */
export async function withServerAiConnection<T>(work:()=>Promise<T>):Promise<T>{
  if(activeConfig.getStore())return work();
  const config=await resolveServerAiConfig();
  return activeConfig.run({config},work);
}

export function withExplicitServerAiConnection<T>(input:ServerAiConnectionPut,work:()=>Promise<T>):Promise<T>{
  const parsed=ServerAiConnectionPutSchema.parse(input);
  return activeConfig.run({config:directConfig(parsed)},work);
}
