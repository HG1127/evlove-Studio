import {z} from "zod";
import {getServerSupabaseConfig,serverSupabaseCredentialMode} from "../server-env";
import {inspectIsolatedLabRuntime} from "../isolated-lab-runtime";
import {dataPlaneFetch,readDataPlaneJson} from "./data-plane-http";
import {supabaseRestAuthHeaders} from "./supabase-rest-auth";

const Id=z.string().min(1).max(200);
const Fingerprint=z.string().regex(/^[0-9a-f]{64}$/);
const MicroUsd=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const CallId=z.uuid();
const Result=z.object({
  allowed:z.boolean(),reason:z.enum([
    "enrolled","reserved","settled","usage-unknown-paused","cancelled",
    "control-inactive","invalid-cap","existing-budget-immutable",
    "invalid-reservation","budget-not-enrolled","budget-inactive",
    "call-id-already-used","budget-exhausted","invalid-cost",
    "unsettled-attempt",
    "budget-not-found","call-not-reserved",
  ]),
}).strict();

export type LabAiBudgetReceipt=z.infer<typeof Result>;
export class LabAiBudgetRejected extends Error {
  readonly code="LAB_AI_BUDGET_REJECTED";
  constructor(readonly reason:LabAiBudgetReceipt["reason"]){
    super("隔离实验 AI 预算操作未获准："+reason);
  }
}

function assertLabBudgetDataPlane(){
  const identity=inspectIsolatedLabRuntime(process.env);
  // This service is never usable on the production data plane, even with a secret.
  if(process.env.EVOLUTION_EXPERIMENT_MODE!=="isolated"
    ||!identity.ready||serverSupabaseCredentialMode()!=="secret"){
    throw Object.assign(new Error("隔离实验数据平面或专用服务凭证不可用。"),
      {code:"LAB_AI_BUDGET_DATA_PLANE_NOT_READY"});
  }
}

/** Service-role-only transactional RPC. No retries for non-idempotent reservations. */
async function invokeBudgetRpc(name:string,payload:Record<string,unknown>){
  assertLabBudgetDataPlane();
  const config=getServerSupabaseConfig();
  const response=await dataPlaneFetch("lab-ai-budget",
    config.url.replace(/\/+$/,"")+"/rest/v1/rpc/"+name,{
      method:"POST",
      headers:{...supabaseRestAuthHeaders(config.anonKey),"Content-Type":"application/json"},
      body:JSON.stringify(payload),
    });
  const result=Result.parse(await readDataPlaneJson("lab-ai-budget",response));
  if(!result.allowed)throw new LabAiBudgetRejected(result.reason);
  return result;
}

/** Enrollment must only be invoked after explicit operator authorization and Lab identity checks. */
export async function initializeLabAiBudget(input:{
  missionId:string;controlJobId:string;maxCalls:number;maxCostMicroUsd:number;deadline:string;
}){
  const data=z.object({missionId:Id,controlJobId:Id,maxCalls:z.number().int().min(1).max(6),
    maxCostMicroUsd:MicroUsd.min(1).max(5_000_000),deadline:z.iso.datetime()}).strict().parse(input);
  return invokeBudgetRpc("initialize_evolution_lab_ai_budget",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,
    p_max_calls:data.maxCalls,p_max_cost_microusd:data.maxCostMicroUsd,p_deadline:data.deadline,
  });
}

/** Reserve before *each* physical provider attempt; retry uses a fresh UUID, never the previous receipt. */
export async function reserveLabAiBudgetCall(input:{
  missionId:string;controlJobId:string;callId:string;routeFingerprint:string;reservedCostMicroUsd:number;
}){
  const data=z.object({missionId:Id,controlJobId:Id,callId:CallId,
    routeFingerprint:Fingerprint,reservedCostMicroUsd:MicroUsd.min(1).max(5_000_000)}).strict().parse(input);
  return invokeBudgetRpc("reserve_evolution_lab_ai_call",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,
    p_call_id:data.callId,p_route_fingerprint:data.routeFingerprint,
    p_reserved_cost_microusd:data.reservedCostMicroUsd,
  });
}

/** Null measured cost preserves the entire monetary hold and freezes future Lab calls. */
export async function settleLabAiBudgetCall(input:{
  missionId:string;controlJobId:string;callId:string;measuredCostMicroUsd:number|null;
}){
  const data=z.object({missionId:Id,controlJobId:Id,callId:CallId,
    measuredCostMicroUsd:MicroUsd.nullable()}).strict().parse(input);
  return invokeBudgetRpc("settle_evolution_lab_ai_call",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,p_call_id:data.callId,
    p_measured_cost_microusd:data.measuredCostMicroUsd,
  });
}

/** Never refunds unmeasured attempts. The existing Job cancellation guard remains authoritative. */
export async function cancelLabAiBudget(input:{missionId:string;controlJobId:string}){
  const data=z.object({missionId:Id,controlJobId:Id}).strict().parse(input);
  return invokeBudgetRpc("cancel_evolution_lab_ai_budget",{
    p_mission_id:data.missionId,p_control_job_id:data.controlJobId,
  });
}