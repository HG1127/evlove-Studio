import {AsyncLocalStorage} from "node:async_hooks";
import {
  ServerAiConnectionPutSchema,ServerAiConnectionSettingsSchema,ServerAiConnectionStatusSchema,ServerAiConnectionRoleSchema,
  ServerAiStoredConnectionSchema,type EvolutionActor,type ServerAiConnectionPut,type ServerAiConnectionRole,type AiOperation,
} from "@evolution/contracts";
import {getServerAiConfig,serverAiConfigured,serverAiReasoningEffort,serverAiJudgeReasoningEffort,serverAiTimeoutMs,vaultEncryptionConfigured,type ServerAiConfig} from "../server-env";
import {getVaultSecretMetadata,putVaultSecret,resolveVaultSecret} from "./server-vault";
import {serverAiConfigForOperation,serverAiJudgedOperation} from "./server-ai-role-config";

const VAULT_ID="server-ai-default-connection-v1";
const VAULT_SCOPE="ai:default-connection";
const JUDGE_VAULT_ID="server-ai-judge-connection-v1";
const JUDGE_VAULT_SCOPE="ai:judge-connection";
const activeConfig=new AsyncLocalStorage<{config:ServerAiConfig|undefined;judge?:ServerAiConfig}>();
const vaultBinding=(role:ServerAiConnectionRole)=>role==="judge"?{id:JUDGE_VAULT_ID,scope:JUDGE_VAULT_SCOPE}:{id:VAULT_ID,scope:VAULT_SCOPE};

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
  const reasoningEffort=serverAiReasoningEffort();
  const judgeReasoningEffort=serverAiJudgeReasoningEffort();
  return {
    mode:"openai-compatible",apiKey:input.apiKey,baseUrl:normalizeBaseUrl(input.baseUrl),
    model:input.model,timeoutMs:serverAiTimeoutMs(),protocol:input.protocol,responseFormat:input.responseFormat,
    ...(reasoningEffort?{reasoningEffort}:{}),
    ...(judgeReasoningEffort?{judgeReasoningEffort}:{}),
  };
}

export async function getServerAiConnectionStatus(role:ServerAiConnectionRole="generation"){
  const binding=vaultBinding(ServerAiConnectionRoleSchema.parse(role));
  if(!vaultEncryptionConfigured())return ServerAiConnectionStatusSchema.parse({
    storageConfigured:false,configured:false,message:"后端模型加密保存尚未启用；当前仍可测试所选模型。服务端配置完成后，请重新检查保存状态。",
  });
  const metadata=await getVaultSecretMetadata(binding.id);
  if(!metadata)return ServerAiConnectionStatusSchema.parse({
    storageConfigured:true,configured:false,message:role==="judge"?"尚未配置独立验收模型，当前沿用后端默认模型。":"尚未选择后端默认模型。",
  });
  const stored=parseStoredConnection(await resolveVaultSecret(binding.id,binding.scope));
  return ServerAiConnectionStatusSchema.parse({
    storageConfigured:true,configured:true,connection:ServerAiConnectionSettingsSchema.parse(stored),
    revision:metadata.version,message:"后端任务直接使用此模型连接。",
  });
}

export async function saveServerAiConnection(raw:ServerAiConnectionPut,actor:Pick<EvolutionActor,"id"|"role">,role:ServerAiConnectionRole="generation"){
  const binding=vaultBinding(ServerAiConnectionRoleSchema.parse(role));
  const input=ServerAiConnectionPutSchema.parse(raw);
  const config=directConfig(input);
  const stored=ServerAiStoredConnectionSchema.parse({
    ...input,baseUrl:config.mode==="openai-compatible"?config.baseUrl:input.baseUrl,
    version:"server-ai-connection-v1",
  });
  const result=await putVaultSecret({
    id:binding.id,name:role==="judge"?"独立验收模型":"后端默认模型",purpose:"User-selected direct AI provider connection",
    scopes:[binding.scope],value:JSON.stringify(stored),
  },actor);
  return ServerAiConnectionStatusSchema.parse({
    storageConfigured:true,configured:true,connection:ServerAiConnectionSettingsSchema.parse(stored),
    revision:result.metadata.version,message:role==="judge"?"已保存独立验收模型；后续评分和验收将使用此连接，评测资格需另行验证。":"已保存后端模型；后台任务将直接调用这个接口。",
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

async function readJudgeConfig(){
  if(!vaultEncryptionConfigured()||!await getVaultSecretMetadata(JUDGE_VAULT_ID))return undefined;
  // A configured but unavailable/corrupt judge must stop; never substitute the generator.
  return directConfig(parseStoredConnection(await resolveVaultSecret(JUDGE_VAULT_ID,JUDGE_VAULT_SCOPE)));
}

/** Resolve the effective operation route from the same request-local snapshot used by its fingerprint/journal. */
export async function resolveServerAiOperationConfig(operation:AiOperation):Promise<ServerAiConfig|undefined>{
  const snapshot=activeConfig.getStore();
  const judge=serverAiJudgedOperation(operation)?snapshot?snapshot.judge:await readJudgeConfig():undefined;
  const config=judge??(snapshot?snapshot.config:await resolveServerAiConfig());
  return config?serverAiConfigForOperation(config,operation):undefined;
}

/** Pin both generation and optional judge routes before work; nested/concurrent requests retain their own snapshot. */
export async function withServerAiConnection<T>(work:()=>Promise<T>):Promise<T>{
  if(activeConfig.getStore())return work();
  const config=await resolveServerAiConfig();
  const judge=await readJudgeConfig();
  return activeConfig.run({config,judge},work);
}

export function withExplicitServerAiConnection<T>(input:ServerAiConnectionPut,work:()=>Promise<T>):Promise<T>{
  const parsed=ServerAiConnectionPutSchema.parse(input);
  return activeConfig.run({config:directConfig(parsed)},work);
}
