import {AsyncLocalStorage} from "node:async_hooks";

type ProbeScope={remainingPhysicalCalls:number;maxOutputTokens:number};
const scope=new AsyncLocalStorage<ProbeScope>();
const isolated=()=>process.env.EVOLUTION_EXPERIMENT_MODE==="isolated";

/** Only call this after application-level ai.execute/security.admin authorization. */
export function withAuthorizedLabAiProbe<T>(work:()=>Promise<T>):Promise<T>{
  if(!isolated()||scope.getStore())return work();
  return scope.run({remainingPhysicalCalls:1,maxOutputTokens:2048},work);
}

/** Prevent unbudgeted mission AI traffic until a durable per-Mission budget ledger exists. */
export function reserveLabAiPhysicalCall(){
  if(!isolated())return;
  const current=scope.getStore();
  if(!current)throw Object.assign(new Error("Lab 模型调用仅允许经过授权的单次健康探针；真实 Mission 必须先建立持久化预算控制。"),{code:"LAB_DURABLE_AI_BUDGET_REQUIRED"});
  if(current.remainingPhysicalCalls<1)throw Object.assign(new Error("Lab 健康探针的物理模型调用额度已用完。"),{code:"LAB_PROBE_CALL_LIMIT_REACHED"});
  current.remainingPhysicalCalls-=1;
}

export function limitLabAiOutputTokens(requested:number){
  if(!isolated())return requested;
  const current=scope.getStore();
  if(!current)throw Object.assign(new Error("Lab 模型调用缺少授权的健康探针上下文。"),{code:"LAB_DURABLE_AI_BUDGET_REQUIRED"});
  return Math.min(requested,current.maxOutputTokens);
}
