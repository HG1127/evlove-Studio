import {z} from "zod";
import type {AiProviderUsageObservation,AiUsageRoute,AiUsageScope} from "@evolution/contracts";
import type {ServerAiConfig} from "../server-env";
import {serverControlExecutionBinding} from "./server-control-execution";
import {hasAuthorizedLabAiProbe,reserveLabAiPhysicalCall} from "./server-ai-lab-probe";
import {resolveServerAiConfigForRole} from "./server-ai-connection";
import {serverAiJudgedOperation} from "./server-ai-role-config";
import {reserveLabSubscriptionCall,settleLabSubscriptionCall} from "./server-ai-lab-subscription-budget";
import {assertMiniMaxSubscriptionQuotaSufficient,fetchMiniMaxSubscriptionQuota,type MiniMaxSubscriptionQuota} from "./server-ai-minimax-subscription-quota";

export const LAB_MAX_SUBSCRIPTION_MISSION_TOKENS=300_000;
export const LAB_MAX_SUBSCRIPTION_CALL_TOKENS=100_000;
export const LAB_MAX_SUBSCRIPTION_OUTPUT_TOKENS=12_000;
const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
const lab=()=>process.env.EVOLUTION_EXPERIMENT_MODE==="isolated";
const normalized=(url:string)=>url.replace(/\/+$/,"");

/** Exact provider origin and /v1 API base only: no custom host, path, query or user-info. */
export function assertLabMiniMaxSubscriptionRoutes(routes:Array<{model:string;baseUrl:string}>){
  const allowedOrigins=new Set(["https://api.minimax.io","https://api.minimax.cn"]);
  if(!routes.length||routes.length>2||routes.some(route=>{
    if(!/^minimax-/i.test(route.model))return true;
    try{
      const url=new URL(route.baseUrl);
      return !allowedOrigins.has(url.origin)||normalized(url.pathname)!=="/v1"
        ||Boolean(url.search||url.hash||url.username||url.password);
    }catch{return true;}
  })){
    throw fail("LAB_MINIMAX_ROUTE_UNSUPPORTED","Lab 生成和 Judge 必须使用批准的 MiniMax HTTPS /v1 API 地址。");
  }
  return {maxCalls:6,maxTokens:LAB_MAX_SUBSCRIPTION_MISSION_TOKENS,minRemainingPercent:50};
}

/** Prevent a verified Subscription Key being sent to an unapproved HTTP destination. */
export function assertLabMiniMaxPhysicalEndpoint(config:ServerAiConfig,protocol:"chat-completions"|"responses",url:string){
  if(!lab())return;
  if(config.mode!=="openai-compatible"){
    throw fail("LAB_MINIMAX_ROUTE_UNSUPPORTED","Lab 只能使用保存的 MiniMax HTTP 连接。");
  }
  assertLabMiniMaxSubscriptionRoutes([{model:config.model,baseUrl:config.baseUrl}]);
  const expected=normalized(config.baseUrl)+(protocol==="responses"?"/responses":"/chat/completions");
  if(url!==expected)throw fail("LAB_MINIMAX_ENDPOINT_NOT_APPROVED","模型物理请求目标地址与保存的 MiniMax 路由不一致。");
}
const Request=z.object({
  model:z.string().min(1),
  max_tokens:z.number().int().positive().optional(),
  max_output_tokens:z.number().int().positive().optional(),
}).passthrough();

export type LabSubscriptionDispatchReservation={
  missionId:string;controlJobId:string;callId:string;reservedTokens:number;
  inputUpperBound:number;outputUpperBound:number;model:string;quota:MiniMaxSubscriptionQuota;
};

/** Every physical HTTP attempt gets a fresh live quota read and a durable token reservation before fetch. */
export async function reserveLabAiDispatchAttempt(input:{
  callId:string;config:ServerAiConfig;route:AiUsageRoute;scope:AiUsageScope|undefined;body:RequestInit["body"];
}):Promise<LabSubscriptionDispatchReservation|undefined>{
  if(!lab())return undefined;
  if(hasAuthorizedLabAiProbe()){
    if(serverControlExecutionBinding())throw fail("LAB_PROBE_SCOPE_FORBIDDEN","Mission 不允许借用单次健康探针绕过持久化订阅额度账本。");
    reserveLabAiPhysicalCall();return undefined;
  }
  const binding=serverControlExecutionBinding();
  if(!binding||binding.generation!==1||!input.scope
    ||input.scope.missionId!==binding.missionId||input.scope.jobId!==binding.controlJobId){
    throw fail("LAB_SUBSCRIPTION_BUDGET_REQUIRED","Lab Mission 缺少受信控制 Job 或用量归属，已阻断模型调用。");
  }
  const config=input.config;
  if(config.mode!=="openai-compatible"||typeof input.body!=="string"
    ||input.route.model!==config.model||input.route.protocol==="ai-sdk"){
    throw fail("LAB_MINIMAX_ROUTE_UNSUPPORTED","当前模型请求无法绑定到可审计的 MiniMax HTTP 路由。");
  }
  const role=serverAiJudgedOperation(input.route.operation)?"judge":"generation";
  const saved=await resolveServerAiConfigForRole(role);
  if(!saved||saved.mode!=="openai-compatible"||saved.apiKey!==config.apiKey
    ||saved.model!==config.model||normalized(saved.baseUrl)!==normalized(config.baseUrl)
    ||(saved.protocol&&saved.protocol!==input.route.protocol)){
    throw fail("LAB_MINIMAX_ROLE_ROUTE_MISMATCH","物理模型请求与已保存的生成/Judge Vault 角色不匹配，禁止调用。");
  }
  const bytes=Buffer.byteLength(input.body,"utf8");
  if(bytes<1||bytes>90_000)throw fail("LAB_SUBSCRIPTION_INPUT_UNBOUNDED","模型输入过大，无法建立可靠 Token 预留上界。");
  let parsed:unknown;try{parsed=JSON.parse(input.body);}catch{
    throw fail("LAB_SUBSCRIPTION_INPUT_UNBOUNDED","模型请求正文无法验证。");
  }
  const request=Request.safeParse(parsed);
  const output=request.success?(input.route.protocol==="responses"
    ?request.data.max_output_tokens:request.data.max_tokens):undefined;
  const foreignOutput=request.success?(input.route.protocol==="responses"
    ?request.data.max_tokens:request.data.max_output_tokens):undefined;
  const multimodal=/"(?:image_url|input_image|input_audio|audio_url|video_url)"\s*:/.test(input.body);
  const inputBound=bytes+8192;
  if(!request.success||request.data.model!==config.model||!output||foreignOutput!==undefined||multimodal
    ||output>LAB_MAX_SUBSCRIPTION_OUTPUT_TOKENS){
    throw fail("LAB_SUBSCRIPTION_INPUT_UNBOUNDED","模型请求的文本输入/输出 Token 上界不受隔离订阅策略覆盖。");
  }
  const reservedTokens=inputBound+output;
  if(reservedTokens>LAB_MAX_SUBSCRIPTION_CALL_TOKENS){
    throw fail("LAB_SUBSCRIPTION_CALL_CAP_EXCEEDED","单次模型调用超过 100,000 Token 的实验保护上限。");
  }
  const quota=assertMiniMaxSubscriptionQuotaSufficient(await fetchMiniMaxSubscriptionQuota(config));
  await reserveLabSubscriptionCall({
    missionId:binding.missionId,controlJobId:binding.controlJobId,callId:input.callId,
    routeFingerprint:input.route.routeFingerprint,reservedTokens,quota,
  });
  return {missionId:binding.missionId,controlJobId:binding.controlJobId,callId:input.callId,
    reservedTokens,inputUpperBound:inputBound,outputUpperBound:output,model:config.model,quota};
}

/** Provider usage is token evidence, not a USD estimate. Missing usage keeps the full hold and pauses the budget. */
export async function settleLabAiDispatchAttempt(
  reservation:LabSubscriptionDispatchReservation|undefined,observation:AiProviderUsageObservation,
){
  if(!reservation)return;
  const {usage,responseModel}=observation,counts=usage.counts;
  const countsAvailable=usage.status==="complete"&&counts.input!==undefined&&counts.output!==undefined
    &&(!responseModel||responseModel===reservation.model);
  const inputOutputTotal=countsAvailable?counts.input!+counts.output!:null;
  const measuredTokens=inputOutputTotal===null?null:Math.max(inputOutputTotal,counts.total??0);
  await settleLabSubscriptionCall({missionId:reservation.missionId,controlJobId:reservation.controlJobId,
    callId:reservation.callId,measuredTokens});
  if(measuredTokens===null)throw fail("LAB_SUBSCRIPTION_USAGE_UNVERIFIED","模型用量缺失或模型身份不可信，订阅预算已暂停，禁止继续生成。");
  if(measuredTokens>reservation.reservedTokens){
    throw fail("LAB_SUBSCRIPTION_TOKEN_OVERRUN","模型实际 Token 用量超过本次预留，预算已记录超额。");
  }
}