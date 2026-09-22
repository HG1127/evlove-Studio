import type {EvolveProject,ReleaseObservation} from "@evolution/contracts";

export const PRODUCTION_OUTCOME_FRESHNESS_MS=30*60*1000;
export const PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS=2*60*1000;
export const RELEASE_OBSERVATION_RETENTION_MS=7*24*60*60*1000;
export const RELEASE_OBSERVATION_MAX_ENTRIES=120;
export const PRODUCTION_OUTCOME_MIN_HEALTHY_STREAK=2;
export const PRODUCTION_OUTCOME_TREND_WINDOW=6;
export const PRODUCTION_OUTCOME_FLAP_TRANSITIONS=2;
export const PRODUCTION_OUTCOME_UNHEALTHY_STREAK=2;

function observationId(input:Omit<ReleaseObservation,"id">){
  return [
    input.source,
    input.action,
    input.candidateId??"-",
    input.deploymentId??"-",
    input.environment??"-",
    input.at,
    input.observationStatus??"-",
    String(input.healthy??""),
  ].join("|");
}

export function appendReleaseObservation(
  current:ReleaseObservation[]|undefined,
  input:Omit<ReleaseObservation,"id"> & {id?:string},
  options?:{maxEntries?:number;retentionMs?:number},
){
  const maxEntries=options?.maxEntries??RELEASE_OBSERVATION_MAX_ENTRIES;
  const retentionMs=options?.retentionMs??RELEASE_OBSERVATION_RETENTION_MS;
  const observation:ReleaseObservation={...input,id:input.id??observationId(input)};
  const anchor=Date.parse(observation.at);
  const lowerBound=Number.isFinite(anchor)?anchor-retentionMs:undefined;
  const merged=[
    ...(current??[]).filter((item)=>item.id!==observation.id),
    observation,
  ].filter((item)=>{
    if(lowerBound===undefined)return true;
    const at=Date.parse(item.at);
    return !Number.isFinite(at)||at>=lowerBound;
  }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  return merged.slice(-maxEntries);
}

export type ProductionOutcomeFreshnessStatus="fresh"|"stale"|"unknown";

export type ProductionOutcomeFreshness={
  status:ProductionOutcomeFreshnessStatus;
  reason:string;
  observedAt?:string;
  ageMs?:number;
  maxAgeMs:number;
};

export function productionOutcomeFreshness(
  project:EvolveProject,
  options?:{now?:number;maxAgeMs?:number;maxFutureSkewMs?:number},
):ProductionOutcomeFreshness{
  const maxAgeMs=options?.maxAgeMs??PRODUCTION_OUTCOME_FRESHNESS_MS;
  const maxFutureSkewMs=options?.maxFutureSkewMs??PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS;
  const observedAt=project.release.observedAt;
  if(!["promoted","rolled-back"].includes(project.release.status)){
    return {status:"unknown",reason:"当前 Release 尚无 Production 终态。",observedAt,maxAgeMs};
  }
  if(project.release.evidenceMode!=="live"||project.release.environment!=="production"){
    return {status:"unknown",reason:"当前 Production Outcome 缺少 live production evidence。",observedAt,maxAgeMs};
  }
  if(!observedAt){
    return {status:"unknown",reason:"当前 Production Outcome 缺少 observedAt。",maxAgeMs};
  }
  const observedMs=Date.parse(observedAt);
  if(!Number.isFinite(observedMs)){
    return {status:"unknown",reason:"Production Outcome observedAt 无法解析。",observedAt,maxAgeMs};
  }
  const now=options?.now??Date.now();
  if(observedMs>now+maxFutureSkewMs){
    return {
      status:"unknown",
      reason:`Production Outcome observedAt 超前超过 ${Math.round(maxFutureSkewMs/1000)} 秒允许时钟漂移，拒绝作为 fresh evidence。`,
      observedAt,maxAgeMs,
    };
  }
  const ageMs=Math.max(0,now-observedMs);
  if(ageMs>maxAgeMs){
    return {
      status:"stale",
      reason:`Production Outcome 已超过 ${Math.round(maxAgeMs/60000)} 分钟 freshness 窗口，需要重新观测。`,
      observedAt,ageMs,maxAgeMs,
    };
  }
  return {
    status:"fresh",
    reason:project.release.observationStatus==="observing"
      ?"Production Outcome 时间新鲜，但仍处于 observing。"
      :project.release.healthy===false
        ?"Production Outcome 时间新鲜，且当前观测为 unhealthy。"
        :"Production Outcome 在 freshness 窗口内。",
    observedAt,ageMs,maxAgeMs,
  };
}

export function projectHasFreshHealthyProductionOutcome(
  project:EvolveProject,
  options?:{now?:number;maxAgeMs?:number;maxFutureSkewMs?:number},
){
  const freshness=productionOutcomeFreshness(project,options);
  return freshness.status==="fresh"
    &&project.release.healthy===true
    &&project.release.observationStatus==="healthy";
}

export type ProductionOutcomeTrendStatus=
  |"stable-healthy"
  |"healthy-insufficient"
  |"degrading"
  |"flapping"
  |"stale"
  |"unknown";

export type ProductionOutcomeTrend={
  status:ProductionOutcomeTrendStatus;
  reason:string;
  healthyStreak:number;
  unhealthyStreak:number;
  transitions:number;
  observations:number;
};

function currentProductionObservations(
  project:EvolveProject,
  now:number,
  maxAgeMs:number,
  maxFutureSkewMs:number,
){
  const deploymentId=project.release.deploymentId;
  return (project.release.observations??[])
    .filter((item)=>item.evidenceMode==="live"
      &&item.environment==="production"
      &&Boolean(deploymentId)
      &&item.deploymentId===deploymentId)
    .filter((item)=>{
      const at=Date.parse(item.at);
      return Number.isFinite(at)&&at<=now+maxFutureSkewMs&&Math.max(0,now-at)<=maxAgeMs;
    })
    .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}

export function productionOutcomeTrend(
  project:EvolveProject,
  options?:{now?:number;maxAgeMs?:number;maxFutureSkewMs?:number;minHealthyStreak?:number},
):ProductionOutcomeTrend{
  const now=options?.now??Date.now();
  const maxAgeMs=options?.maxAgeMs??PRODUCTION_OUTCOME_FRESHNESS_MS;
  const maxFutureSkewMs=options?.maxFutureSkewMs??PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS;
  const minHealthyStreak=options?.minHealthyStreak??PRODUCTION_OUTCOME_MIN_HEALTHY_STREAK;
  const freshness=productionOutcomeFreshness(project,{now,maxAgeMs,maxFutureSkewMs});
  if(freshness.status==="stale"){
    return {status:"stale",reason:freshness.reason,healthyStreak:0,unhealthyStreak:0,transitions:0,observations:0};
  }
  if(freshness.status==="unknown"){
    return {status:"unknown",reason:freshness.reason,healthyStreak:0,unhealthyStreak:0,transitions:0,observations:0};
  }
  const observations=currentProductionObservations(project,now,maxAgeMs,maxFutureSkewMs).slice(0,PRODUCTION_OUTCOME_TREND_WINDOW);
  if(!observations.length){
    return {
      status:project.release.healthy===true?"healthy-insufficient":"unknown",
      reason:project.release.healthy===true
        ?`Production 当前 healthy，但 Observation Ledger 尚无足够连续证据；至少需要 ${minHealthyStreak} 次 healthy 观测。`
        :"Observation Ledger 尚无当前 Production Deployment 的 live 观测。",
      healthyStreak:project.release.healthy===true?1:0,
      unhealthyStreak:project.release.healthy===false?1:0,
      transitions:0,
      observations:0,
    };
  }
  const states=observations
    .filter((item)=>item.observationStatus==="healthy"||item.observationStatus==="unhealthy")
    .map((item)=>item.observationStatus as "healthy"|"unhealthy");
  let healthyStreak=0;
  for(const state of states){
    if(state!=="healthy")break;
    healthyStreak+=1;
  }
  let unhealthyStreak=0;
  for(const state of states){
    if(state!=="unhealthy")break;
    unhealthyStreak+=1;
  }
  let transitions=0;
  for(let i=1;i<states.length;i++)if(states[i]!==states[i-1])transitions+=1;
  if(unhealthyStreak>=PRODUCTION_OUTCOME_UNHEALTHY_STREAK){
    return {
      status:"degrading",
      reason:`Production 最近连续 ${unhealthyStreak} 次 unhealthy，需要人工核对或恢复。`,
      healthyStreak,unhealthyStreak,transitions,observations:observations.length,
    };
  }
  if(transitions>=PRODUCTION_OUTCOME_FLAP_TRANSITIONS){
    return {
      status:"flapping",
      reason:`最近 ${states.length} 次 Production 观测发生 ${transitions} 次健康状态切换，存在 flapping。`,
      healthyStreak,unhealthyStreak,transitions,observations:observations.length,
    };
  }
  if(healthyStreak>=minHealthyStreak){
    return {
      status:"stable-healthy",
      reason:`Production 已连续 ${healthyStreak} 次 healthy，满足稳定证据门槛。`,
      healthyStreak,unhealthyStreak,transitions,observations:observations.length,
    };
  }
  if(states[0]==="unhealthy"){
    return {
      status:"degrading",
      reason:"Production 最新观测为 unhealthy，尚未形成连续异常但不能视为稳定健康。",
      healthyStreak,unhealthyStreak,transitions,observations:observations.length,
    };
  }
  return {
    status:"healthy-insufficient",
    reason:`Production 当前 healthy，但只有 ${healthyStreak} 次连续 healthy；至少需要 ${minHealthyStreak} 次。`,
    healthyStreak,unhealthyStreak,transitions,observations:observations.length,
  };
}

export function projectHasStableHealthyProductionOutcome(
  project:EvolveProject,
  options?:{now?:number;maxAgeMs?:number;maxFutureSkewMs?:number;minHealthyStreak?:number},
){
  return projectHasFreshHealthyProductionOutcome(project,options)
    &&productionOutcomeTrend(project,options).status==="stable-healthy";
}

export type ReleaseAuditItem={
  at:string;
  action:string;
  note:string;
  candidateId?:string;
  deploymentId?:string;
  stableDeploymentId?:string;
  artifactHashes?:Array<{sourceArtifactId:string;contentHash:string}>;
  evidenceMode?:string;
  environment?:string;
  observedAt?:string;
  healthy?:boolean;
  observationStatus?:string;
  reason?:string;
  source:"history"|"recovery";
};

export function releaseAuditTimeline(project:EvolveProject):ReleaseAuditItem[]{
  const history=project.release.history.map((entry)=>({...entry,source:"history" as const}));
  const recovery=project.release.recovery
    ?[{
      at:project.release.recovery.lastObservedAt??project.release.recovery.at,
      action:`recovery:${project.release.recovery.status}`,
      note:project.release.recovery.reason,
      candidateId:project.release.candidateId,
      deploymentId:project.release.deploymentId,
      stableDeploymentId:project.release.stableDeploymentId,
      artifactHashes:project.release.artifactHashes,
      evidenceMode:project.release.evidenceMode,
      environment:project.release.environment,
      observedAt:project.release.recovery.lastObservedAt??project.release.observedAt,
      healthy:project.release.healthy,
      observationStatus:project.release.observationStatus,
      reason:project.release.recovery.reason,
      source:"recovery" as const,
    }]
    :[];
  return [...history,...recovery].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
