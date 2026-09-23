import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  MissionEnvelopeSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  missionEnvelope,
  type EvolutionEvent,
  type EvolutionJob,
  type MissionEnvelope,
  type ProductionRuntimePorts,
} from "@evolution/contracts";
import { getServerSupabaseConfig } from "../server-env";
import { mirrorEvolutionEventToEvidenceLedger } from "./evidence-ledger";

type JsonRecord=Record<string,unknown>;
export type ServerControlRuntime=Pick<ProductionRuntimePorts,"missions"|"jobs"|"events">;

function rowMissionEnvelope(row:JsonRecord):MissionEnvelope{
  return MissionEnvelopeSchema.parse({
    schemaVersion:row.schema_version,
    missionId:row.id,
    revision:Number(row.revision??0),
    payload:row.payload,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  });
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

export class MissionRevisionConflictError extends Error{
  readonly code="MISSION_REVISION_CONFLICT";
  readonly missionId:string;
  readonly expectedRevision:number;
  readonly currentRevision?:number;
  constructor(missionId:string,expectedRevision:number,currentRevision?:number){
    super(`Mission ${missionId} revision conflict: expected ${expectedRevision}, current ${currentRevision??"missing"}`);
    this.name="MissionRevisionConflictError";
    this.missionId=missionId;
    this.expectedRevision=expectedRevision;
    this.currentRevision=currentRevision;
  }
}

function revisionValue(value:unknown){
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&parsed>=0?parsed:undefined;
}

export async function listServerMissionEnvelopes(){
  const {request}=createRestClient();
  const rows=await request("missions?select=*&order=updated_at.desc") as JsonRecord[];
  return (rows??[]).map(rowMissionEnvelope);
}

export async function getServerMissionEnvelope(id:string){
  const {request}=createRestClient();
  const rows=await request("missions?id=eq."+encodeURIComponent(id)+"&select=*&limit=1") as JsonRecord[];
  return rows?.[0]?rowMissionEnvelope(rows[0]):undefined;
}

export async function compareAndSwapServerMissionEnvelope(envelopeInput:MissionEnvelope){
  const envelope=MissionEnvelopeSchema.parse(envelopeInput);
  const {request}=createRestClient();
  const rows=await request("rpc/compare_and_swap_mission",{
    method:"POST",
    body:JSON.stringify({
      p_id:envelope.missionId,
      p_expected_revision:envelope.revision,
      p_schema_version:envelope.schemaVersion,
      p_stage:envelope.payload.stage,
      p_status:envelope.payload.campaign.status,
      p_payload:envelope.payload,
      p_created_at:envelope.createdAt,
      p_updated_at:envelope.updatedAt,
    }),
  }) as Array<{applied?:unknown;current_revision?:unknown;mission?:unknown}>;
  const result=rows?.[0];
  if(result?.applied===true&&result.mission&&typeof result.mission==="object"&&!Array.isArray(result.mission)){
    return rowMissionEnvelope(result.mission as JsonRecord);
  }
  throw new MissionRevisionConflictError(
    envelope.missionId,
    envelope.revision,
    revisionValue(result?.current_revision),
  );
}

export async function deleteServerMissionIfRevision(id:string,expectedRevision:number){
  const {request}=createRestClient();
  const rows=await request("rpc/delete_mission_if_revision",{
    method:"POST",
    body:JSON.stringify({p_id:id,p_expected_revision:expectedRevision}),
  }) as Array<{applied?:unknown;current_revision?:unknown}>;
  const result=rows?.[0];
  if(result?.applied===true)return;
  throw new MissionRevisionConflictError(id,expectedRevision,revisionValue(result?.current_revision));
}

export function getServerProductionRuntime():ServerControlRuntime{
  // Request/workflow scoped by construction: revision context must never be shared
  // between concurrent callers, or one caller could accidentally advance another's CAS token.
  const {request}=createRestClient();
  const missionRevisions=new Map<string,number>();

  return {
    missions:{
      initialize:async()=>undefined,
      list:async()=>{
        const rows=await request("missions?select=*&order=updated_at.desc") as JsonRecord[];
        const envelopes=(rows??[]).map(rowMissionEnvelope);
        const remoteIds=new Set(envelopes.map((envelope)=>envelope.missionId));
        for(const envelope of envelopes)missionRevisions.set(envelope.missionId,envelope.revision);
        for(const id of [...missionRevisions.keys()])if(!remoteIds.has(id))missionRevisions.delete(id);
        return envelopes.map((envelope)=>envelope.payload);
      },
      get:async(id)=>{
        const rows=await request("missions?id=eq."+encodeURIComponent(id)+"&select=*&limit=1") as JsonRecord[];
        if(!rows?.[0]){missionRevisions.delete(id);return undefined;}
        const envelope=rowMissionEnvelope(rows[0]);
        missionRevisions.set(id,envelope.revision);
        return envelope.payload;
      },
      save:async(project)=>{
        const expectedRevision=missionRevisions.get(project.id)??0;
        const saved=await compareAndSwapServerMissionEnvelope(missionEnvelope(project,expectedRevision));
        missionRevisions.set(project.id,saved.revision);
      },
      delete:async(id)=>{
        await deleteServerMissionIfRevision(id,missionRevisions.get(id)??0);
        missionRevisions.delete(id);
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
}

export function resetServerProductionRuntime(){
  // Kept for test/API compatibility. The runtime no longer owns process-global mutable state.
}

export const SERVER_CONTROL_SCHEMA_VERSIONS={
  mission:PRODUCTION_SCHEMA_VERSIONS.mission,
  job:PRODUCTION_SCHEMA_VERSIONS.job,
  event:PRODUCTION_SCHEMA_VERSIONS.event,
} as const;
