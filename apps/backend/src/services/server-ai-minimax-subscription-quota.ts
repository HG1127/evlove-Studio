import {z} from "zod";
import type {ServerAiConfig} from "../server-env";

export const LAB_MINIMAX_MIN_REMAINING_PERCENT=50;
const MAX_PERCENT=1000;
const MINIMAX_QUOTA_ORIGINS:Record<string,string>={
  "api.minimax.io":"https://www.minimax.io",
  "api.minimax.cn":"https://www.minimax.cn",
};
const Entry=z.object({
  model_name:z.string().min(1).max(80),
  current_interval_remaining_percent:z.number().finite().min(0).max(MAX_PERCENT),
  current_interval_status:z.number().int().min(0).max(3),
  current_weekly_remaining_percent:z.number().finite().min(0).max(MAX_PERCENT),
  current_weekly_status:z.number().int().min(0).max(3),
  end_time:z.number().int().positive().optional(),
  weekly_end_time:z.number().int().positive().optional(),
  remains_time:z.number().int().positive().optional(),
  weekly_remains_time:z.number().int().positive().optional(),
}).passthrough();
const Envelope=z.object({
  base_resp:z.object({status_code:z.number().int()}).passthrough().optional(),
  code:z.number().int().optional(),
  model_remains:z.array(z.unknown()).optional(),
  data:z.object({model_remains:z.array(z.unknown()).optional()}).passthrough().optional(),
}).passthrough();

export type MiniMaxSubscriptionQuota={
  provider:"minimax-m-plan";
  modelGroup:"general";
  intervalRemainingPercent:number;
  weeklyRemainingPercent:number;
  intervalStatus:1;
  weeklyStatus:1;
  intervalResetAt:string;
  weeklyResetAt:string;
  observedAt:string;
  endpointOrigin:string;
};

const fail=(code:string,message:string)=>Object.assign(new Error(message),{code});
function quotaOrigin(baseUrl:string){
  let hostname:string;
  try{hostname=new URL(baseUrl).hostname.toLowerCase();}catch{
    throw fail("LAB_MINIMAX_ROUTE_INVALID","MiniMax 模型路由地址无效。");
  }
  const origin=MINIMAX_QUOTA_ORIGINS[hostname];
  if(!origin)throw fail("LAB_MINIMAX_REGION_UNSUPPORTED","当前 MiniMax 区域没有已核实的订阅额度查询入口。");
  return origin;
}
function resetAt(epochMs:number|undefined,remainingMs:number|undefined,now:number){
  const value=epochMs??(remainingMs===undefined?undefined:now+remainingMs);
  if(value===undefined||!Number.isSafeInteger(value)||value<=now||value>now+8*24*60*60*1000){
    throw fail("LAB_MINIMAX_QUOTA_INVALID","MiniMax 订阅额度窗口重置时间缺失或无效。");
  }
  return new Date(value).toISOString();
}

/** Reads only MiniMax subscription quota; never returns or logs the bearer key or raw response. */
export async function fetchMiniMaxSubscriptionQuota(config:ServerAiConfig):Promise<MiniMaxSubscriptionQuota>{
  if(config.mode!=="openai-compatible"||!/^minimax-/i.test(config.model)){
    throw fail("LAB_MINIMAX_SUBSCRIPTION_REQUIRED","隔离 Lab 只允许使用已保存的 MiniMax 订阅模型连接。");
  }
  const origin=quotaOrigin(config.baseUrl);
  let response:Response;
  try{
    response=await fetch(origin+"/v1/token_plan/remains",{
      method:"GET",
      headers:{Authorization:"Bearer "+config.apiKey,"Content-Type":"application/json"},
      cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000),
    });
  }catch{
    throw fail("LAB_MINIMAX_QUOTA_UNAVAILABLE","MiniMax 订阅额度查询失败或超时。");
  }
  if(!response.ok){
    throw fail(response.status===401||response.status===403
      ?"LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED":"LAB_MINIMAX_QUOTA_UNAVAILABLE",
    "MiniMax 订阅额度接口未返回成功状态。");
  }
  let raw:unknown;
  try{raw=await response.json();}catch{
    throw fail("LAB_MINIMAX_QUOTA_INVALID","MiniMax 订阅额度接口返回的 JSON 无效。");
  }
  const envelope=Envelope.safeParse(raw);
  if(!envelope.success)throw fail("LAB_MINIMAX_QUOTA_INVALID","MiniMax 订阅额度响应结构不受支持。");
  const businessCode=envelope.data.base_resp?.status_code??envelope.data.code;
  if(businessCode!==0){
    throw fail("LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED","MiniMax 未确认此连接具有有效的 M Plan Subscription Key 权限。");
  }
  const rows=envelope.data.model_remains??envelope.data.data?.model_remains;
  if(!rows)throw fail("LAB_MINIMAX_QUOTA_INVALID","MiniMax 订阅额度响应缺少 model_remains。");
  const general=rows.filter((row)=>row&&typeof row==="object"&&!Array.isArray(row)
    &&(row as Record<string,unknown>).model_name==="general");
  if(general.length!==1)throw fail("LAB_MINIMAX_QUOTA_INVALID","MiniMax 订阅额度中没有唯一的 general 文本资源组。");
  const parsed=Entry.safeParse(general[0]);
  if(!parsed.success)throw fail("LAB_MINIMAX_QUOTA_INVALID","MiniMax general 额度窗口字段缺失或无效。");
  const row=parsed.data,now=Date.now();
  if(row.current_interval_status!==1||row.current_weekly_status!==1){
    throw fail("LAB_MINIMAX_QUOTA_INACTIVE","MiniMax 5 小时或周额度窗口未处于可用状态。");
  }
  const intervalResetAt=resetAt(row.end_time,row.remains_time,now);
  const weeklyResetAt=resetAt(row.weekly_end_time,row.weekly_remains_time,now);
  return {
    provider:"minimax-m-plan",modelGroup:"general",
    intervalRemainingPercent:row.current_interval_remaining_percent,
    weeklyRemainingPercent:row.current_weekly_remaining_percent,
    intervalStatus:1,weeklyStatus:1,intervalResetAt,weeklyResetAt,
    observedAt:new Date(now).toISOString(),endpointOrigin:origin,
  };
}

export function assertMiniMaxSubscriptionQuotaSufficient(
  quota:MiniMaxSubscriptionQuota,minRemainingPercent=LAB_MINIMAX_MIN_REMAINING_PERCENT,
){
  const min=z.number().finite().min(1).max(100).parse(minRemainingPercent);
  if(quota.intervalRemainingPercent<min||quota.weeklyRemainingPercent<min){
    throw fail("LAB_MINIMAX_QUOTA_LOW","MiniMax 5 小时或周订阅额度低于隔离实验安全阈值。");
  }
  return quota;
}
