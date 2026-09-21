import {createHash} from "node:crypto";
import type {
  EvolveProject,
  OutcomeMetricBatchRequest,
  OutcomeMetricSampleInput,
  VercelReleaseHealth,
  VercelReleaseObservation,
} from "@evolution/contracts";
import {serverSupabaseSecureConfigured} from "../server-env";
import {insertOutcomeSamples} from "./outcome-sample-store";
import {collectConfiguredOutcomeTelemetry,getOutcomeTelemetryCapabilities} from "./outcome-telemetry-source";

function sampleId(parts:string[]){
  return "release-outcome-"+createHash("sha256").update(parts.join("|")).digest("hex").slice(0,32);
}

function armForDeployment(project:EvolveProject,deploymentId:string|undefined){
  if(!deploymentId)return undefined;
  if(project.release.stableDeploymentId&&deploymentId===project.release.stableDeploymentId)return "stable" as const;
  if(project.release.deploymentId&&deploymentId===project.release.deploymentId)return "candidate" as const;
  return undefined;
}

function healthSamples(args:{
  project:EvolveProject;
  observation:VercelReleaseObservation;
  deploymentId?:string;
  health?:VercelReleaseHealth;
  sourceKind:"production"|"bound";
}):OutcomeMetricSampleInput[]{
  const arm=armForDeployment(args.project,args.deploymentId);
  if(!arm||!args.health||!args.deploymentId)return[];
  const deploymentId=args.deploymentId;
  const common={
    candidateId:args.project.release.candidateId,
    deploymentId,
    arm,
    source:"vercel-release-observation",
    observedAt:args.observation.checkedAt,
    metadata:{
      provider:"vercel",
      releaseStatus:args.project.release.status,
      trafficPercent:args.observation.rollingRelease?.currentPercentage??args.project.release.trafficPercent,
      rollingReleaseActive:args.observation.rollingRelease?.active??false,
      rollingStageIndex:args.observation.rollingRelease?.currentStageIndex,
      observationSource:args.sourceKind,
      deploymentId,
    },
  };
  const aggregate:OutcomeMetricSampleInput[]=[
    {
      ...common,
      id:sampleId([args.project.id,args.observation.checkedAt,deploymentId,"latency_ms","all"]),
      metricKey:"latency_ms",
      metricKind:"latency",
      direction:"lower",
      value:args.health.latencyMs,
      unit:"ms",
      segment:"all",
    },
    {
      ...common,
      id:sampleId([args.project.id,args.observation.checkedAt,deploymentId,"health_ready","all"]),
      metricKey:"health_ready",
      metricKind:"safety",
      direction:"higher",
      value:args.health.ready?1:0,
      unit:"ratio",
      segment:"all",
    },
  ];
  const perPath=args.health.checks.flatMap((check):OutcomeMetricSampleInput[]=>[
    {
      ...common,
      id:sampleId([args.project.id,args.observation.checkedAt,deploymentId,"latency_ms",check.path]),
      metricKey:"latency_ms",
      metricKind:"latency",
      direction:"lower",
      value:check.latencyMs,
      unit:"ms",
      segment:"path:"+check.path,
      metadata:{...common.metadata,httpStatus:check.status,path:check.path},
    },
    {
      ...common,
      id:sampleId([args.project.id,args.observation.checkedAt,deploymentId,"http_ok",check.path]),
      metricKey:"http_ok",
      metricKind:"safety",
      direction:"higher",
      value:check.ok?1:0,
      unit:"ratio",
      segment:"path:"+check.path,
      metadata:{...common.metadata,httpStatus:check.status,path:check.path},
    },
  ]);
  return [...aggregate,...perPath];
}

export function buildReleaseOutcomeBatch(
  project:EvolveProject,
  observation:VercelReleaseObservation,
):OutcomeMetricBatchRequest|undefined{
  const samples=[
    ...healthSamples({
      project,observation,
      deploymentId:observation.productionDeployment?.id,
      health:observation.productionHealth,
      sourceKind:"production",
    }),
    ...healthSamples({
      project,observation,
      deploymentId:observation.boundDeployment?.id,
      health:observation.boundHealth,
      sourceKind:"bound",
    }),
  ];
  const deduped=[...new Map(samples.map((sample)=>[sample.id!,sample])).values()];
  if(!deduped.length)return undefined;
  return {
    missionId:project.id,
    candidateId:project.release.candidateId,
    samples:deduped,
  };
}

export async function recordReleaseOutcomeObservation(
  project:EvolveProject,
  observation:VercelReleaseObservation,
){
  const telemetryCapabilities=getOutcomeTelemetryCapabilities();
  if(!serverSupabaseSecureConfigured())return {
    recorded:false,inserted:0,reason:"secure-data-plane-not-configured",
    telemetry:{...telemetryCapabilities,requestCount:0,sampleCount:0,warnings:[] as string[]},
  };
  const healthBatch=buildReleaseOutcomeBatch(project,observation);
  const telemetry=await collectConfiguredOutcomeTelemetry(project,observation);
  const samples=[...new Map([
    ...(healthBatch?.samples??[]),
    ...telemetry.samples,
  ].map((sample)=>[sample.id!,sample])).values()];
  if(!samples.length)return {
    recorded:false,inserted:0,
    reason:telemetry.warnings.length?"no-outcome-samples; telemetry warnings: "+telemetry.warnings.join("; "):"no-bound-stable-or-candidate-deployment",
    telemetry:{...telemetry,sampleCount:0},
  };
  let inserted=0;
  const messages:string[]=[];
  for(let offset=0;offset<samples.length;offset+=1000){
    const result=await insertOutcomeSamples({
      missionId:project.id,
      candidateId:project.release.candidateId,
      samples:samples.slice(offset,offset+1000),
    });
    inserted+=result.inserted;
    messages.push(result.message);
  }
  return {
    recorded:true,
    inserted,
    reason:telemetry.warnings.length
      ?messages.join(" ")+" Telemetry warnings: "+telemetry.warnings.join("; ")
      :messages.join(" "),
    telemetry:{...telemetry,sampleCount:telemetry.samples.length},
  };
}
