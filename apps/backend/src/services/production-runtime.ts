import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  MissionEnvelopeSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  missionEnvelope,
  type EvolveProject,
  type EvolutionEvent,
  type EvolutionJob,
  type ProductionRuntimePorts,
} from "@evolution/contracts";
import { getServerSupabaseConfig } from "../server-env";
import { mirrorEvolutionEventToEvidenceLedger } from "./evidence-ledger";

type JsonRecord=Record<string,unknown>;
export type ServerControlRuntime=Pick<ProductionRuntimePorts,"missions"|"jobs"|"events">;

function missionRow(project:EvolveProject){
  const envelope=missionEnvelope(project);
  return {
    id:envelope.missionId,
    schema_version:envelope.schemaVersion,
    stage:project.stage,
    status:project.campaign.status,
    payload:envelope.payload,
    created_at:envelope.createdAt,
    updated_at:envelope.updatedAt,
  };
}

function rowMission(row:JsonRecord):EvolveProject{
  return MissionEnvelopeSchema.parse({
    schemaVersion:row.schema_version,
    missionId:row.id,
    revision:Number(row.revision??0),
    payload:row.payload,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  }).payload;
}

function jobRow(job:EvolutionJob){
  const value=EvolutionJobSchema.parse(job);
  return {
    id:value.id,mission_id:value.missionId??null,schema_version:value.schemaVersion,
    type:value.type,status:value.status,label:value.label,idempotency_key:value.idempotencyKey,
    generation:value.generation,attempts:value.attempts,priority:value.priority,
    checkpoint_id:value.checkpointId??null,input_ref:value.inputRef??null,output_ref:value.outputRef??null,
    metadata:value.metadata??{},progress:value.progress??null,error:value.error??null,created_at:value.createdAt,
    started_at:value.startedAt??null,heartbeat_at:value.heartbeatAt??null,
    finished_at:value.finishedAt??null,updated_at:value.updatedAt,
  };
}

function rowJob(row:JsonRecord):EvolutionJob{
  return EvolutionJobSchema.parse({
    schemaVersion:row.schema_version,id:row.id,missionId:row.mission_id??undefined,
    type:row.type,status:row.status,label:row.label,idempotencyKey:row.idempotency_key,
    generation:row.generation,attempts:row.attempts,priority:row.priority,
    checkpointId:row.checkpoint_id??undefined,inputRef:row.input_ref??undefined,
    outputRef:row.output_ref??undefined,metadata:row.metadata??undefined,progress:row.progress??undefined,error:row.error??undefined,
    createdAt:row.created_at,startedAt:row.started_at??undefined,heartbeatAt:row.heartbeat_at??undefined,
    finishedAt:row.finished_at??undefined,updatedAt:row.updated_at,
  });
}

function eventRow(event:EvolutionEvent){
  const value=EvolutionEventSchema.parse(event);
  return {
    id:value.id,mission_id:value.missionId??null,schema_version:value.schemaVersion,
    type:value.type,source:value.source,job_id:value.jobId??null,checkpoint_id:value.checkpointId??null,
    causation_id:value.causationId??null,correlation_id:value.correlationId??null,
    payload:value.payload,at:value.at,
  };
}

function rowEvent(row:JsonRecord):EvolutionEvent{
  return EvolutionEventSchema.parse({
    schemaVersion:row.schema_version,id:row.id,missionId:row.mission_id??undefined,
    type:row.type,source:row.source,jobId:row.job_id??undefined,
    checkpointId:row.checkpoint_id??undefined,causationId:row.causation_id??undefined,
    correlationId:row.correlation_id??undefined,payload:row.payload??{},at:row.at,
  });
}

function createRestClient(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const baseHeaders={
    apikey:config.anonKey,
    Authorization:"Bearer "+config.anonKey,
    "Content-Type":"application/json",
  };

  async function request(path:string,init:RequestInit={}){
    const response=await fetch(root+"/"+path,{
      ...init,
      headers:{...baseHeaders,...(init.headers??{})},
    });
    if(!response.ok){
      const detail=await response.text().catch(()=>"");
      throw new Error("Supabase PostgREST HTTP "+response.status+": "+detail.slice(0,500));
    }
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  }

  return {request};
}

let runtime:ServerControlRuntime|undefined;

export function getServerProductionRuntime():ServerControlRuntime{
  if(runtime)return runtime;
  const {request}=createRestClient();

  runtime={
    missions:{
      initialize:async()=>undefined,
      list:async()=>{
        const rows=await request("missions?select=*&order=updated_at.desc") as JsonRecord[];
        return (rows??[]).map(rowMission);
      },
      get:async(id)=>{
        const rows=await request("missions?id=eq."+encodeURIComponent(id)+"&select=*&limit=1") as JsonRecord[];
        return rows?.[0]?rowMission(rows[0]):undefined;
      },
      save:async(project)=>{
        await request("missions?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(missionRow(project))});
      },
      delete:async(id)=>{
        await request("missions?id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{Prefer:"return=minimal"}});
      },
      flush:async()=>undefined,
    },
    jobs:{
      list:async(missionId)=>{
        const filter=missionId?"&mission_id=eq."+encodeURIComponent(missionId):"";
        const rows=await request("jobs?select=*&order=updated_at.desc"+filter) as JsonRecord[];
        return (rows??[]).map(rowJob);
      },
      get:async(id)=>{
        const rows=await request("jobs?id=eq."+encodeURIComponent(id)+"&select=*&limit=1") as JsonRecord[];
        return rows?.[0]?rowJob(rows[0]):undefined;
      },
      put:async(job)=>{
        await request("jobs?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(jobRow(job))});
      },
      cancel:async(id)=>{
        const now=new Date().toISOString();
        await request("jobs?id=eq."+encodeURIComponent(id),{
          method:"PATCH",headers:{Prefer:"return=minimal"},
          body:JSON.stringify({status:"cancelled",finished_at:now,updated_at:now}),
        });
      },
    },
    events:{
      append:async(event)=>{
        const parsed=EvolutionEventSchema.parse(event);
        await request("events?on_conflict=id",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify(eventRow(parsed))});
        await mirrorEvolutionEventToEvidenceLedger(parsed).catch(()=>undefined);
      },
      list:async(missionId,limit=200)=>{
        const filter=missionId?"&mission_id=eq."+encodeURIComponent(missionId):"";
        const bounded=Math.max(1,Math.min(limit,1000));
        const rows=await request("events?select=*&order=at.desc&limit="+bounded+filter) as JsonRecord[];
        return (rows??[]).map(rowEvent);
      },
    },
  };
  return runtime;
}

export function resetServerProductionRuntime(){runtime=undefined;}

export const SERVER_CONTROL_SCHEMA_VERSIONS={
  mission:PRODUCTION_SCHEMA_VERSIONS.mission,
  job:PRODUCTION_SCHEMA_VERSIONS.job,
  event:PRODUCTION_SCHEMA_VERSIONS.event,
} as const;
