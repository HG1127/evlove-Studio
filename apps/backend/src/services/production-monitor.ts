import type {EvolveProject} from "@evolution/contracts";
import {productionOutcomeTrend,projectHasLiveReleaseDecision} from "@evolution/core";

export function productionMonitorIntervalMs(){
  const raw=Number(process.env.EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS??"300")||300;
  return Math.max(60,Math.min(raw,3600))*1000;
}

export type ProductionMonitorDecision={
  delayMs:number;
  trend:ReturnType<typeof productionOutcomeTrend>;
  reason:string;
};

export function nextProductionMonitorDelay(
  project:EvolveProject,
  observedAt?:string,
):ProductionMonitorDecision|undefined{
  if(!projectHasLiveReleaseDecision(project))return undefined;
  const parsed=observedAt?Date.parse(observedAt):Date.now();
  const now=Number.isFinite(parsed)?parsed:Date.now();
  const trend=productionOutcomeTrend(project,{now});
  if(trend.status!=="healthy-insufficient"&&trend.status!=="unknown")return undefined;
  const delayMs=productionMonitorIntervalMs();
  return {
    delayMs,
    trend,
    reason:`Production 仍为 ${trend.status}；Durable Workflow 将在 ${Math.round(delayMs/1000)} 秒后重新观测，避免瞬时重复探测伪造连续证据。`,
  };
}
