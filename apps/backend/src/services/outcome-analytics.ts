import {OutcomeAnalyticsHealthSchema} from "@evolution/contracts";
import {analyzeOutcomeSamples} from "@evolution/core";
import {
  getEvolutionWorkspaceId,
  serverSupabaseSecureConfigured,
} from "../server-env";
import {probeOutcomeSampleStore,readOutcomeSamples} from "./outcome-sample-store";
import {getOutcomeTelemetryCapabilities,getOutcomeTelemetryConfigState} from "./outcome-telemetry-source";

export function outcomeMinimumSamplesPerArm(){
  const parsed=Number(process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM??"30");
  if(!Number.isFinite(parsed)||parsed===0)return 30;
  return Math.max(5,Math.min(Math.trunc(parsed),10_000));
}

export async function getOutcomeAnalyticsHealth(){
  const checkedAt=new Date().toISOString();
  const workspaceId=getEvolutionWorkspaceId();
  const secureDataPlane=serverSupabaseSecureConfigured();
  const minimumSamplesPerArm=outcomeMinimumSamplesPerArm();
  const telemetry=getOutcomeTelemetryCapabilities();
  if(!workspaceId||!secureDataPlane){
    return OutcomeAnalyticsHealthSchema.parse({
      codeReady:true,configured:false,databaseReady:false,secureDataPlane,
      ingestionReady:false,analysisReady:false,
      telemetryConfigured:telemetry.configured,telemetryReady:telemetry.ready,
      telemetrySourceCount:telemetry.sourceCount,telemetryMetricCount:telemetry.metricCount,
      minimumSamplesPerArm,checkedAt,
      message:telemetry.configured&&!telemetry.ready
        ?"Outcome Analytics 数据平面未连接；Telemetry 配置同时存在错误："+telemetry.errors.join("; ")
        :"Outcome Analytics 代码已就绪；需要 EVOLUTION_WORKSPACE_ID + server-only Supabase credential。",
    });
  }
  try{
    await probeOutcomeSampleStore();
    return OutcomeAnalyticsHealthSchema.parse({
      codeReady:true,configured:true,databaseReady:true,secureDataPlane:true,
      ingestionReady:true,analysisReady:true,
      telemetryConfigured:telemetry.configured,telemetryReady:telemetry.ready,
      telemetrySourceCount:telemetry.sourceCount,telemetryMetricCount:telemetry.metricCount,
      minimumSamplesPerArm,checkedAt,
      message:telemetry.configured
        ?telemetry.ready
          ?`Outcome Warehouse / ingest / Stable-Candidate statistics / drift analysis 已连接；${telemetry.sourceCount} 个外部 Telemetry source / ${telemetry.metricCount} 个指标已配置。`
          :"Outcome Warehouse 已连接，但 Telemetry 配置不可用："+telemetry.errors.join("; ")
        :"Outcome Warehouse / ingest / Stable-Candidate statistics / drift analysis 已连接；尚未配置外部业务 KPI / Cost / Safety Telemetry。",
    });
  }catch(error){
    return OutcomeAnalyticsHealthSchema.parse({
      codeReady:true,configured:true,databaseReady:false,secureDataPlane:true,
      ingestionReady:false,analysisReady:false,
      telemetryConfigured:telemetry.configured,telemetryReady:telemetry.ready,
      telemetrySourceCount:telemetry.sourceCount,telemetryMetricCount:telemetry.metricCount,
      minimumSamplesPerArm,checkedAt,
      message:error instanceof Error?error.message:String(error),
    });
  }
}

export async function analyzeMissionOutcome(input:{missionId:string;candidateId:string;deploymentId?:string;stableDeploymentId?:string;telemetryOnly?:boolean}){
  const stored=await readOutcomeSamples({missionId:input.missionId,candidateId:input.candidateId,limit:20_000,requireComplete:true});
  const samples=stored.filter(sample=>
    (!input.telemetryOnly||sample.source.startsWith("outcome-telemetry:"))
    &&(!input.deploymentId||sample.arm!=="candidate"||sample.deploymentId===input.deploymentId)
    &&(!input.stableDeploymentId||sample.arm!=="stable"||sample.deploymentId===input.stableDeploymentId));
  const telemetry=getOutcomeTelemetryConfigState();
  return analyzeOutcomeSamples({
    ...input,
    samples,
    minimumSamplesPerArm:outcomeMinimumSamplesPerArm(),
    requiredMetricScopes:telemetry.sources.flatMap((source)=>source.metrics.map((metric)=>({metricKey:metric.metricKey,segment:metric.segment,source:"outcome-telemetry:"+source.id}))),
    telemetryConfigurationError:telemetry.configured&&!telemetry.ready?telemetry.errors.slice(0,3).join("; "):undefined,
  });
}
