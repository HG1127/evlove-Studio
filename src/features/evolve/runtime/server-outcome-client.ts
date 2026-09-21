import {
  OutcomeAnalyticsHealthSchema,
  OutcomeAnalyticsResponseSchema,
  OutcomeMetricBatchResponseSchema,
  type OutcomeAnalyticsHealth,
  type OutcomeAnalyticsResponse,
  type OutcomeMetricBatchRequest,
  type OutcomeMetricBatchResponse,
} from "@evolution/contracts";

async function apiJson(path:string,init?:RequestInit){
  const response=await fetch(path,init);
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String((body as {statusMessage?:string;message?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Outcome API HTTP ${response.status}`);
    throw new Error(message);
  }
  return body;
}

export async function getServerOutcomeHealth():Promise<OutcomeAnalyticsHealth>{
  return OutcomeAnalyticsHealthSchema.parse(await apiJson("/api/evolution/outcome-health"));
}

export async function ingestServerOutcomeSamples(input:OutcomeMetricBatchRequest):Promise<OutcomeMetricBatchResponse>{
  return OutcomeMetricBatchResponseSchema.parse(await apiJson("/api/evolution/outcome-samples",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),
  }));
}

export async function getServerOutcomeAnalysis(missionId:string,candidateId?:string):Promise<OutcomeAnalyticsResponse>{
  const query=new URLSearchParams({missionId});
  if(candidateId)query.set("candidateId",candidateId);
  return OutcomeAnalyticsResponseSchema.parse(await apiJson("/api/evolution/outcome-analysis?"+query.toString()));
}
