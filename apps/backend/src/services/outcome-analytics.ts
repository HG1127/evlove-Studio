import {OutcomeAnalyticsHealthSchema} from "@evolution/contracts";
import {analyzeOutcomeSamples} from "@evolution/core";
import {
  getEvolutionWorkspaceId,
  serverSupabaseSecureConfigured,
} from "../server-env";
import {probeOutcomeSampleStore,readOutcomeSamples} from "./outcome-sample-store";
import {getOutcomeTelemetryCapabilities} from "./outcome-telemetry-source";

export function outcomeMinimumSamplesPerArm(){
  const parsed=Number(process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM??"30")||30;
  return Math.max(5,Math.min(parsed,10_000));
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

export async function analyzeMissionOutcome(input:{missionId:string;candidateId:string}){
  const samples=await readOutcomeSamples(input);
  return analyzeOutcomeSamples({
    ...input,
    samples,
    minimumSamplesPerArm:outcomeMinimumSamplesPerArm(),
  });
}
