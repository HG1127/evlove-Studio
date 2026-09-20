import type {EvolveProject} from "@evolution/contracts";

export const PRODUCTION_OUTCOME_FRESHNESS_MS=30*60*1000;

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
  options?:{now?:number;maxAgeMs?:number},
):ProductionOutcomeFreshness{
  const maxAgeMs=options?.maxAgeMs??PRODUCTION_OUTCOME_FRESHNESS_MS;
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
  options?:{now?:number;maxAgeMs?:number},
){
  const freshness=productionOutcomeFreshness(project,options);
  return freshness.status==="fresh"
    &&project.release.healthy===true
    &&project.release.observationStatus==="healthy";
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
