import {createHash} from "node:crypto";
import {
  createEvolutionEvent,
  EvolveProjectSchema,
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
import {dataPlaneFetch} from "./data-plane-http";
import { mirrorEvolutionEventToEvidenceLedger } from "./evidence-ledger";
import { getServerArtifactStore } from "./artifact-runtime";

type JsonRecord=Record<string,unknown>;
export type ServerControlRuntime=ProductionRuntimePorts;

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
    const response=await dataPlaneFetch("production-runtime",root+"/"+path,{
      ...init,
      headers:{...baseHeaders,...(init.headers??{})},
    });
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  }

  return {request};
}

export class JobStateConflictError extends Error{
  readonly code="JOB_STATE_CONFLICT";
  readonly jobId:string;
  readonly reason:string;
  readonly current?:EvolutionJob;
  constructor(jobId:string,reason:string,current?:EvolutionJob){
    super(`Job ${jobId} write rejected: ${reason}`);
    this.name="JobStateConflictError";
    this.jobId=jobId;
    this.reason=reason;
    this.current=current;
  }
}

export function isBenignJobBookkeepingConflict(error:unknown,generation:number){
  return error instanceof JobStateConflictError
    &&error.current?.generation===generation
    &&["state-regression","terminal-immutable","older-update"].includes(error.reason);
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

export async function createServerMissionEnvelope(projectInput:unknown){
  const {request}=createRestClient();
  const envelope=missionEnvelope(EvolveProjectSchema.parse(projectInput),0);
  await request("missions",{
    method:"POST",
    headers:{Prefer:"return=representation"},
    body:JSON.stringify({
      id:envelope.missionId,
      schema_version:envelope.schemaVersion,
      revision:envelope.revision,
      stage:envelope.payload.stage,
      status:envelope.payload.campaign.status,
      payload:envelope.payload,
      created_at:envelope.createdAt,
      updated_at:envelope.updatedAt,
    }),
  });
  return envelope;
}

function revisionValue(value:unknown){
  const parsed=Number(value);
  return Number.isSafeInteger(parsed)&&parsed>=0?parsed:undefined;
}

function rpcJob(value:unknown){
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  return rowJob(value as JsonRecord);
}

async function putServerJobMonotonic(request:ReturnType<typeof createRestClient>["request"],jobInput:EvolutionJob){
  const job=EvolutionJobSchema.parse(jobInput);
  const digest=createHash("sha256").update(JSON.stringify(job)).digest("hex");
  const event=createEvolutionEvent({
    id:`job-state:${digest}`,missionId:job.missionId,jobId:job.id,
    type:job.status==="queued"?"JobQueued":job.status==="completed"?"JobCompleted"
      :job.status==="failed"?"JobFailed":"JobUpdated",
    source:"backend-job-store",at:job.updatedAt,
    payload:{status:job.status,generation:job.generation,progress:job.progress,error:job.error,
      requestedJobHash:digest},
  });
  const rows=await request("rpc/put_evolution_job_with_event",{
    method:"POST",body:JSON.stringify({p_job:job,p_event:event}),
  }) as Array<{applied?:unknown;reason?:unknown;job?:unknown}>;
  const result=rows?.[0];
  const current=rpcJob(result?.job);
  if(result?.applied===true&&current){
    await mirrorEvolutionEventToEvidenceLedger(event).catch(()=>undefined);
    return current;
  }
  throw new JobStateConflictError(job.id,typeof result?.reason==="string"?result.reason:"unknown",current);
}

async function cancelServerJobGeneration(
  request:ReturnType<typeof createRestClient>["request"],
  id:string,
  expectedGeneration:number,
){
  const at=new Date().toISOString();
  const rows=await request("rpc/cancel_evolution_job_generation_with_event",{
    method:"POST",body:JSON.stringify({p_id:id,p_expected_generation:expectedGeneration,p_at:at}),
  }) as Array<{applied?:unknown;reason?:unknown;job?:unknown}>;
  const result=rows?.[0];
  const current=rpcJob(result?.job);
  if(result?.applied===true&&current){
    await mirrorEvolutionEventToEvidenceLedger(createEvolutionEvent({
      id:`job-cancel:${id}:${expectedGeneration}`,missionId:current.missionId,jobId:id,
      type:"JobUpdated",source:"backend-job-store",at,
      payload:{status:"cancelled",generation:expectedGeneration},
    })).catch(()=>undefined);
    return current;
  }
  if(result?.reason==="already-terminal"&&current)return current;
  throw new JobStateConflictError(id,typeof result?.reason==="string"?result.reason:"unknown",current);
}

export async function bindServerJobWorkflowRun(
  id:string,
  expectedGeneration:number,
  runId:string,
  binding:"metadata"|"output-ref",
){
  const {request}=createRestClient();
  const rows=await request("rpc/bind_evolution_job_workflow_run",{
    method:"POST",
    body:JSON.stringify({
      p_id:id,
      p_expected_generation:expectedGeneration,
      p_run_id:runId,
      p_binding:binding,
      p_at:new Date().toISOString(),
    }),
  }) as Array<{applied?:unknown;reason?:unknown;job?:unknown}>;
  const result=rows?.[0];
  const current=rpcJob(result?.job);
  if(result?.applied===true&&current)return current;
  throw new JobStateConflictError(id,typeof result?.reason==="string"?result.reason:"unknown",current);
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

export async function getServerValidationResult(id:string){
  const {request}=createRestClient();
  const query="events?select=payload&payload->>validationId=eq."+encodeURIComponent(id)+"&limit=1";
  const rows=await request(query) as Array<{payload?:unknown}>;
  const payload=rows?.[0]?.payload;
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return undefined;
  const validation=(payload as JsonRecord).validation;
  return validation&&typeof validation==="object"&&!Array.isArray(validation)?validation:undefined;
}

export async function listServerActiveJobs(limit=100,missionId?:string){
  const {request}=createRestClient();
  const bounded=Math.max(1,Math.min(limit,100));
  const filter=missionId?"&mission_id=eq."+encodeURIComponent(missionId):"";
  const base="jobs?select=*&status=in.(queued,running,waiting)&order=updated_at.asc&limit="+bounded+filter;
  const [parseRows,controlRows]=await Promise.all([
    request(base+"&type=eq.parse") as Promise<JsonRecord[]>,
    request(base+"&type=eq.campaign&idempotency_key=like.workflow-control*") as Promise<JsonRecord[]>,
  ]);
  return [...(parseRows??[]),...(controlRows??[])]
    .map(rowJob)
    .filter((job)=>job.type==="parse"||(job.type==="campaign"&&job.idempotencyKey.startsWith("workflow-control:")))
    .sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))
    .slice(0,bounded);
}

export async function createServerJobIdempotent(jobInput:EvolutionJob){
  const job=EvolutionJobSchema.parse(jobInput);
  const {request}=createRestClient();
  const rows=await request("rpc/create_evolution_job_idempotent",{
    method:"POST",body:JSON.stringify({p_job:job}),
  }) as Array<{applied?:unknown;reason?:unknown;job?:unknown}>;
  const result=rows?.[0];
  const current=rpcJob(result?.job);
  if(result?.applied===true&&current)return current;
  throw new JobStateConflictError(job.id,typeof result?.reason==="string"?result.reason:"unknown",current);
}

export async function transitionServerJobWithEvent(
  jobInput:EvolutionJob,eventInput:EvolutionEvent,
){
  const job=EvolutionJobSchema.parse(jobInput);
  const event=EvolutionEventSchema.parse(eventInput);
  const {request}=createRestClient();
  const rows=await request("rpc/transition_evolution_job_with_event",{
    method:"POST",body:JSON.stringify({
      p_id:job.id,p_expected_generation:job.generation,p_job:job,p_event:event,
    }),
  }) as Array<{applied?:unknown;reason?:unknown;job?:unknown}>;
  const result=rows?.[0];
  const current=rpcJob(result?.job);
  if(result?.applied===true&&current)return current;
  throw new JobStateConflictError(job.id,typeof result?.reason==="string"?result.reason:"unknown",current);
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

export async function compareAndSwapServerMissionEnvelopeWithEvent(
  envelopeInput:MissionEnvelope,eventInput:EvolutionEvent,
){
  const envelope=MissionEnvelopeSchema.parse(envelopeInput);
  const event=EvolutionEventSchema.parse(eventInput);
  const {request}=createRestClient();
  const rows=await request("rpc/compare_and_swap_mission_with_event",{
    method:"POST",body:JSON.stringify({
      p_id:envelope.missionId,p_expected_revision:envelope.revision,p_schema_version:envelope.schemaVersion,
      p_stage:envelope.payload.stage,p_status:envelope.payload.campaign.status,p_payload:envelope.payload,
      p_created_at:envelope.createdAt,p_updated_at:envelope.updatedAt,p_event:event,
    }),
  }) as Array<{applied?:unknown;current_revision?:unknown;mission?:unknown}>;
  const result=rows?.[0];
  if(result?.applied===true&&result.mission&&typeof result.mission==="object"&&!Array.isArray(result.mission)){
    return rowMissionEnvelope(result.mission as JsonRecord);
  }
  throw new MissionRevisionConflictError(envelope.missionId,envelope.revision,revisionValue(result?.current_revision));
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
  const jobGenerations=new Map<string,number>();

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
        const jobs=(rows??[]).map(rowJob);
        for(const job of jobs)jobGenerations.set(job.id,job.generation);
        return jobs;
      },
      get:async(id)=>{
        const rows=await request("jobs?id=eq."+encodeURIComponent(id)+"&select=*&limit=1") as JsonRecord[];
        if(!rows?.[0]){jobGenerations.delete(id);return undefined;}
        const job=rowJob(rows[0]);
        jobGenerations.set(id,job.generation);
        return job;
      },
      put:async(job)=>{
        const saved=await putServerJobMonotonic(request,job);
        jobGenerations.set(saved.id,saved.generation);
      },
      cancel:async(id)=>{
        let generation=jobGenerations.get(id);
        if(generation===undefined){
          const rows=await request("jobs?id=eq."+encodeURIComponent(id)+"&select=*&limit=1") as JsonRecord[];
          if(!rows?.[0])throw new JobStateConflictError(id,"missing");
          const current=rowJob(rows[0]);
          generation=current.generation;
          jobGenerations.set(id,generation);
        }
        const saved=await cancelServerJobGeneration(request,id,generation);
        jobGenerations.set(id,saved.generation);
      },
    },
    artifacts:getServerArtifactStore(),
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
