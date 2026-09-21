import {randomUUID} from "node:crypto";
import {
  OutcomeMetricBatchRequestSchema,
  OutcomeMetricBatchResponseSchema,
  OutcomeMetricSampleSchema,
  type OutcomeMetricBatchRequest,
  type OutcomeMetricSample,
} from "@evolution/contracts";
import {getEvolutionWorkspaceId,getServerSupabaseConfig} from "../server-env";

type JsonRecord=Record<string,unknown>;

function db(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const baseHeaders={apikey:config.anonKey,Authorization:"Bearer "+config.anonKey,"Content-Type":"application/json"};
  return async(path:string,init:RequestInit={})=>{
    const response=await fetch(root+"/"+path,{...init,headers:{...baseHeaders,...(init.headers??{})}});
    if(!response.ok){
      const detail=await response.text().catch(()=>"");
      throw new Error("Outcome sample store HTTP "+response.status+": "+detail.slice(0,500));
    }
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  };
}

function fromRow(row:JsonRecord):OutcomeMetricSample{
  return OutcomeMetricSampleSchema.parse({
    id:row.id,workspaceId:row.workspace_id,missionId:row.mission_id,
    candidateId:row.candidate_id??undefined,deploymentId:row.deployment_id??undefined,
    arm:row.arm,metricKey:row.metric_key,metricKind:row.metric_kind,direction:row.direction,
    value:Number(row.value),unit:row.unit??undefined,segment:row.segment??"all",
    source:row.source,observedAt:row.observed_at,metadata:row.metadata??{},
  });
}

export async function insertOutcomeSamples(raw:OutcomeMetricBatchRequest){
  const input=OutcomeMetricBatchRequestSchema.parse(raw);
  const workspaceId=getEvolutionWorkspaceId();
  if(!workspaceId)throw new Error("EVOLUTION_WORKSPACE_ID is required");
  const rows=input.samples.map((sample)=>({
    id:sample.id??"outcome-"+randomUUID(),workspace_id:workspaceId,mission_id:input.missionId,
    candidate_id:sample.candidateId??input.candidateId??null,deployment_id:sample.deploymentId??null,
    arm:sample.arm,metric_key:sample.metricKey,metric_kind:sample.metricKind,direction:sample.direction,
    value:sample.value,unit:sample.unit??null,segment:sample.segment,source:sample.source,
    observed_at:sample.observedAt,metadata:sample.metadata,
  }));
  const inserted=await db()("outcome_metric_samples?on_conflict=id",{
    method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(rows),
  }) as JsonRecord[]|undefined;
  return OutcomeMetricBatchResponseSchema.parse({
    missionId:input.missionId,inserted:inserted?.length??0,
    message:`Accepted ${rows.length} samples; inserted ${inserted?.length??0} new rows.`,
  });
}

export async function readOutcomeSamples(input:{missionId:string;candidateId?:string;limit?:number}){
  const workspaceId=getEvolutionWorkspaceId();
  if(!workspaceId)throw new Error("EVOLUTION_WORKSPACE_ID is required");
  const candidate=input.candidateId?"&candidate_id=eq."+encodeURIComponent(input.candidateId):"";
  const limit=Math.max(1,Math.min(input.limit??10_000,20_000));
  const rows=await db()(
    "outcome_metric_samples?select=*"
    +"&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&mission_id=eq."+encodeURIComponent(input.missionId)
    +candidate+"&order=observed_at.asc&limit="+limit,
  ) as JsonRecord[];
  return (rows??[]).map(fromRow);
}

export async function probeOutcomeSampleStore(){
  await db()("outcome_metric_samples?select=id&limit=1");
  return true;
}
