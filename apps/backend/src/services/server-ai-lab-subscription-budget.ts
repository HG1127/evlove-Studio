import {z} from "zod";
import {getServerSupabaseConfig,serverSupabaseCredentialMode} from "../server-env";
import {inspectIsolatedLabRuntime} from "../isolated-lab-runtime";
import {dataPlaneFetch,readDataPlaneJson} from "./data-plane-http";
import {supabaseRestAuthHeaders} from "./supabase-rest-auth";
import type {MiniMaxSubscriptionQuota} from "./server-ai-minimax-subscription-quota";

const Id=z.string().min(1).max(200);
const Fingerprint=z.string().regex(/^[0-9a-f]{64}$/);
const CallId=z.uuid();
const Tokens=z.number().int().min(1).max(100_000);
const Percent=z.number().finite().min(0).max(1000);
const Result=z.object({allowed:z.boolean(),reason:z.enum([
  "enrolled","reserved","settled","usage-unknown-paused","cancelled","overspent",
  "control-inactive","invalid-cap","existing-budget-immutable","budget-not-enrolled",
  "budget-inactive","call-id-already-used","budget-exhausted","invalid-reservation",
  "invalid-usage","quota-stale","quota-insufficient","unsettled-attempt",
  "budget-not-found","call-not-reserved",
])}).strict();
export type LabSubscriptionBudgetReceipt=z.infer<typeof Result>;
export class LabSubscriptionBudgetRejected extends Error{
  readonly code="LAB_SUBSCRIPTION_BUDGET_REJECTED";
  constructor(readonly reason:LabSubscriptionBudgetReceipt["reason"]){
    super("隔离实验订阅额度操作未获准："+reason);
  }
}
function assertLabSubscriptionDataPlane(){
  const identity=inspectIsolatedLabRuntime(process.env);
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated"
    ||!identity.ready||serverSupabaseCredentialMode()!=="secret"){
    throw Object.assign(new Error("隔离实验数据平面或专用服务凭证不可用。"),
      {code:"LAB_SUBSCRIPTION_DATA_PLANE_NOT_READY"});
  }
}
async function invoke(name:string,payload:Record<string,unknown>){
  assertLabSubscriptionDataPlane();
  const config=getServerSupabaseConfig();
  const response=await dataPlaneFetch("lab-minimax-subscription-budget",
    config.url.replace(/\/+$/,"")+"/rest/v1/rpc/"+name,{
      method:"POST",
      headers:{...supabaseRestAuthHeaders(config.anonKey),"Content-Type":"application/json"},
      body:JSON.stringify(payload),
    });
  const result=Result.parse(await readDataPlaneJson("lab-minimax-subscription-budget",response));
  if(!result.allowed)throw new LabSubscriptionBudgetRejected(result.reason);
  return result;
}
export async function initializeLabSubscriptionBudget(input:{
  missionId:string;controlJobId:string;maxCalls:number;maxTokens:number;deadline:string;
  minIntervalRemainingPercent:number;minWeeklyRemainingPercent:number;
}){
  const data=z.object({missionId:Id,controlJobId:Id,maxCalls:z.number().int().min(1).max(6),
    maxTokens:z.number().int().min(10_000).max(300_000),deadline:z.iso.datetime(),
    minIntervalRemainingPercent:Percent.min(1).max(100),
    minWeeklyRemainingPercent:Percent.min(1).max(100)}).strict().parse(input);
  return invoke("initialize_evolution_lab_subscription_budget",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,p_max_calls:data.maxCalls,
    p_max_tokens:data.maxTokens,p_deadline:data.deadline,
    p_min_interval_remaining_percent:data.minIntervalRemainingPercent,
    p_min_weekly_remaining_percent:data.minWeeklyRemainingPercent,
  });
}
export async function reserveLabSubscriptionCall(input:{
  missionId:string;controlJobId:string;callId:string;routeFingerprint:string;reservedTokens:number;
  quota:MiniMaxSubscriptionQuota;
}){
  const data=z.object({missionId:Id,controlJobId:Id,callId:CallId,routeFingerprint:Fingerprint,
    reservedTokens:Tokens,quota:z.object({
      intervalRemainingPercent:Percent,weeklyRemainingPercent:Percent,
      intervalStatus:z.literal(1),weeklyStatus:z.literal(1),
      intervalResetAt:z.iso.datetime(),weeklyResetAt:z.iso.datetime(),observedAt:z.iso.datetime(),
    }).passthrough()}).strict().parse(input);
  return invoke("reserve_evolution_lab_subscription_call",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,p_call_id:data.callId,
    p_route_fingerprint:data.routeFingerprint,p_reserved_tokens:data.reservedTokens,
    p_interval_remaining_percent:data.quota.intervalRemainingPercent,
    p_weekly_remaining_percent:data.quota.weeklyRemainingPercent,
    p_interval_status:data.quota.intervalStatus,p_weekly_status:data.quota.weeklyStatus,
    p_interval_reset_at:data.quota.intervalResetAt,p_weekly_reset_at:data.quota.weeklyResetAt,
    p_quota_observed_at:data.quota.observedAt,
  });
}
export async function settleLabSubscriptionCall(input:{
  missionId:string;controlJobId:string;callId:string;measuredTokens:number|null;
}){
  const data=z.object({missionId:Id,controlJobId:Id,callId:CallId,
    measuredTokens:z.number().int().min(0).max(10_000_000).nullable()}).strict().parse(input);
  return invoke("settle_evolution_lab_subscription_call",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,
    p_call_id:data.callId,p_measured_tokens:data.measuredTokens,
  });
}
export async function cancelLabSubscriptionBudget(input:{missionId:string;controlJobId:string}){
  const data=z.object({missionId:Id,controlJobId:Id}).strict().parse(input);
  return invoke("cancel_evolution_lab_subscription_budget",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,
  });
}
