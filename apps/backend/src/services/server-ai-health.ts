import {
  ServerAiRuntimeHealthSchema,
  type ServerAiRuntimeHealth,
} from "@evolution/contracts";
import {createHash} from "node:crypto";
import type {ServerAiConfig} from "../server-env";
import {resolveServerAiConfig,withServerAiConnection} from "./server-ai-connection";
import {
  runServerAi,
  serverAiUnavailableMessage,
  serverAiUnavailableReason,
} from "./ai-gateway";

type ProbeRunner=(operation:"understand",payload:unknown)=>Promise<unknown>;

const DEFAULT_PROBE_CACHE_MS=60_000;
const defaultProbeRunner:ProbeRunner=(operation,payload)=>runServerAi(operation,payload);
let probeCache:{key:string;at:number;value:ServerAiRuntimeHealth}|undefined;
let probeInFlight:{key:string;promise:Promise<ServerAiRuntimeHealth>}|undefined;

function probeFingerprint(config:ServerAiConfig){
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function resetServerAiRuntimeProbeCache(){
  probeCache=undefined;
  probeInFlight=undefined;
}

export async function getPassiveServerAiHealth():Promise<ServerAiRuntimeHealth>{
  const config=await resolveServerAiConfig();
  if(!config){
    return ServerAiRuntimeHealthSchema.parse({
      checkedAt:new Date().toISOString(),
      codeReady:true,
      configured:false,
      mode:"missing",
      ready:false,
      runtimeVerified:false,
      status:"unconfigured",
      message:"Server AI 未配置。",
    });
  }
  return ServerAiRuntimeHealthSchema.parse({
    checkedAt:new Date().toISOString(),
    codeReady:true,
    configured:true,
    mode:config.mode,
    model:config.model,
    ready:false,
    runtimeVerified:false,
    status:"not-checked",
    message:"Server AI 配置已存在，但普通健康检查不会产生模型调用；需主动 Runtime Probe 才能确认真实可用。",
  });
}

export async function probeServerAiRuntime(
  runner:ProbeRunner=defaultProbeRunner,
  options:{force?:boolean;cacheMs?:number;isolated?:boolean}={},
):Promise<ServerAiRuntimeHealth>{
  return withServerAiConnection(async()=>{
  const passive=await getPassiveServerAiHealth();
  const config=await resolveServerAiConfig();
  if(!config)return passive;
  const key=probeFingerprint(config);
  const now=Date.now();
  const cacheMs=Math.max(0,options.cacheMs??DEFAULT_PROBE_CACHE_MS);

  if(!options.isolated&&probeInFlight?.key===key)return probeInFlight.promise;
  if(!options.isolated&&!options.force&&probeCache?.key===key&&now-probeCache.at<cacheMs)return probeCache.value;

  const promise=(async()=>{
    let health:ServerAiRuntimeHealth;
    try{
      await runner("understand",{
        command:"Server AI runtime health probe only. Return the requested structured understanding. Do not publish, persist, deploy, or call external tools.",
        artifacts:[],
      });
      health=ServerAiRuntimeHealthSchema.parse({
        ...passive,
        checkedAt:new Date().toISOString(),
        ready:true,
        runtimeVerified:true,
        status:"ready",
        message:"Server AI Runtime Probe 已通过真实模型调用。",
      });
    }catch(error){
      const reasonCode=serverAiUnavailableReason(error);
      const detail=error instanceof Error?error.message:String(error);
      const safeDetail=config.mode==="openai-compatible"?detail.replaceAll(config.apiKey,"[REDACTED]"):detail;
      health=reasonCode
        ?ServerAiRuntimeHealthSchema.parse({
          ...passive,
          checkedAt:new Date().toISOString(),
          ready:false,
          runtimeVerified:true,
          status:"unavailable",
          reasonCode,
          message:serverAiUnavailableMessage(reasonCode),
        })
        :ServerAiRuntimeHealthSchema.parse({
          ...passive,
          checkedAt:new Date().toISOString(),
          ready:false,
          runtimeVerified:true,
          status:"error",
          reasonCode:"runtime-error",
          message:`Server AI Runtime Probe 失败：${safeDetail}`,
        });
    }
    if(!options.isolated)probeCache={key,at:Date.now(),value:health};
    return health;
  })();

  if(!options.isolated)probeInFlight={key,promise};
  try{
    return await promise;
  }finally{
    if(probeInFlight?.promise===promise)probeInFlight=undefined;
  }
  });
}
