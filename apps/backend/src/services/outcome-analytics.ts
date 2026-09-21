import {OutcomeAnalyticsHealthSchema} from "@evolution/contracts";
import {analyzeOutcomeSamples} from "@evolution/core";
import {
  getEvolutionWorkspaceId,
  serverSupabaseSecureConfigured,
} from "../server-env";
import {probeOutcomeSampleStore,readOutcomeSamples} from "./outcome-sample-store";

export function outcomeMinimumSamplesPerArm(){
  const parsed=Number(process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM??"30")||30;
  return Math.max(5,Math.min(parsed,10_000));
}

export async function getOutcomeAnalyticsHealth(){
  const checkedAt=new Date().toISOString();
  const workspaceId=getEvolutionWorkspaceId();
  const secureDataPlane=serverSupabaseSecureConfigured();
  const minimumSamplesPerArm=outcomeMinimumSamplesPerArm();
  if(!workspaceId||!secureDataPlane){
    return OutcomeAnalyticsHealthSchema.parse({
      codeReady:true,configured:false,databaseReady:false,secureDataPlane,
      ingestionReady:false,analysisReady:false,minimumSamplesPerArm,checkedAt,
      message:"Outcome Analytics 代码已就绪；需要 EVOLUTION_WORKSPACE_ID + server-only Supabase credential。",
    });
  }
  try{
    await probeOutcomeSampleStore();
    return OutcomeAnalyticsHealthSchema.parse({
      codeReady:true,configured:true,databaseReady:true,secureDataPlane:true,
      ingestionReady:true,analysisReady:true,minimumSamplesPerArm,checkedAt,
      message:"Outcome Warehouse / ingest / Stable-Candidate statistics / drift analysis 已连接。",
    });
  }catch(error){
    return OutcomeAnalyticsHealthSchema.parse({
      codeReady:true,configured:true,databaseReady:false,secureDataPlane:true,
      ingestionReady:false,analysisReady:false,minimumSamplesPerArm,checkedAt,
      message:error instanceof Error?error.message:String(error),
    });
  }
}

export async function analyzeMissionOutcome(input:{missionId:string;candidateId?:string}){
  const samples=await readOutcomeSamples(input);
  return analyzeOutcomeSamples({
    ...input,
    samples,
    minimumSamplesPerArm:outcomeMinimumSamplesPerArm(),
  });
}
