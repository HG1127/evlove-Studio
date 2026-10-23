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
import {supabaseRestAuthHeaders} from "./supabase-rest-auth";
import { mirrorEvolutionEventToEvidenceLedger } from "./evidence-ledger";
import {appendServerEvent,probeServerEventReadback,readServerEventById,rowEvent} from "./event-persistence";
import {probeEventEvidencePage,readEventEvidencePage} from "./event-evidence-pages";
import {readServerValidationRecord} from "./validation-event-record";
import {probeServerEventPage as probeEventPage,readServerEventRows} from "./event-pages";
import {probeActiveJobPage,readActiveJobRows} from "./active-job-pages";
import {readRecentParseJobRows} from "./parse-job-pages";
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

function createRestClient(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const baseHeaders={
    ...supabaseRestAuthHeaders(config.anonKey),
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

async function readRowsByIdPage(
  request:ReturnType<typeof createRestClient>["request"],
  table:"missions"|"jobs",
  filter="",
  cursor?:string,
  limit=500,
){
  const path=`${table}?select=*&order=id.asc&limit=${limit}${filter}`
    +(cursor?`&id=gt.${encodeURIComponent(cursor)}`:"");
  const page=await request(path);
  if(!Array.isArray(page))throw new Error(`${table} list response is not an array`);
  if(page.length===0)return {rows:[] as JsonRecord[],nextCursor:undefined};
  const last=page[page.length-1] as JsonRecord;
  if(typeof last?.id!=="string"||!last.id||last.id===cursor){
    throw new Error(`${table} list cursor is invalid`);
  }
  return {rows:page as JsonRecord[],nextCursor:last.id};
}

async function listAllRowsById(
  request:ReturnType<typeof createRestClient>["request"],
  table:"missions"|"jobs",
  filter="",
){
  const rows:JsonRecord[]=[];
  let cursor:string|undefined;
  // A server-side row cap can be lower than our requested limit. Read until an
  // empty page so a short page never looks like the end of the collection.
  for(;;){
    const page=await readRowsByIdPage(request,table,filter,cursor);
    if(!page.nextCursor)return rows;
    rows.push(...page.rows);
    cursor=page.nextCursor;
  }
}

function newestFirst<T extends {updatedAt:string}>(rows:T[]){
  return rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
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

export class ActiveJobQueryError extends Error{
  readonly query:"parse"|"campaign";
  constructor(query:"parse"|"campaign",cause:unknown){
    super("Active Job query failed",{cause});
    this.name="ActiveJobQueryError";
    this.query=query;
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
  const rows=await listAllRowsById(request,"missions");
  return newestFirst(rows.map(rowMissionEnvelope));
}

export async function listServerMissionEnvelopePage(cursor?:string,limit=100){
  const {request}=createRestClient();
  const page=await readRowsByIdPage(request,"missions","",cursor,limit);
  return {items:page.rows.map(rowMissionEnvelope),nextCursor:page.nextCursor};
}

export async function listServerJobPage(missionId?:string,cursor?:string,limit=100){
  const {request}=createRestClient();
  const filter=missionId?"&mission_id=eq."+encodeURIComponent(missionId):"";
  const page=await readRowsByIdPage(request,"jobs",filter,cursor,limit);
  return {items:page.rows.map(rowJob),nextCursor:page.nextCursor};
}

export async function getServerMissionEnvelope(id:string){
  const {request}=createRestClient();
  const rows=await request("missions?id=eq."+encodeURIComponent(id)+"&select=*&limit=1") as JsonRecord[];
  return rows?.[0]?rowMissionEnvelope(rows[0]):undefined;
}

export async function getServerValidationRecord(id:string){
  const {request}=createRestClient();
  return readServerValidationRecord(request,id);
}

export async function getServerEventById(id:string){
  const {request}=createRestClient();
  return readServerEventById(request,id);
}

export async function getServerValidationResult(id:string){
  return (await getServerValidationRecord(id))?.result;
}

export async function listServerActiveJobs(limit=100,missionId?:string){
  const {request}=createRestClient();
  const bounded=Math.max(1,Math.min(limit,100));
  async function read(kind:"parse"|"campaign",status:"queued"|"running"|"waiting"){
    try{return await readActiveJobRows(request,{kind,status,limit:bounded,missionId});}
    catch(error){throw new ActiveJobQueryError(kind,error);}
  }
  const statuses=["queued","running","waiting"] as const;
  const rows=await Promise.all(statuses.flatMap((status)=>[
    read("parse",status),read("campaign",status),
  ]));
  return rows.flat()
    .map(rowJob)
    .sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id))
    .slice(0,bounded);
}

/**
 * HTML start protection needs EVERY active Campaign for this one Mission.
 * The generic reconciliation inventory intentionally filters workflow-control
 * receipts and mixes parse jobs; either behavior can hide a blocking Campaign.
 * Query Campaigns separately, including historical idempotency keys.
 */
export async function listServerActiveMissionCampaignJobs(missionId:string,limit=100){
  const {request}=createRestClient();
  const bounded=Math.max(1,Math.min(limit,100));
  const statuses=["queued","running","waiting"] as const;
  const pages=await Promise.all(statuses.map(async status=>{
    try{
      return await readActiveJobRows(request,{
        kind:"campaign",status,missionId,limit:bounded,campaignKeyScope:"all",
      });
    }catch(error){throw new ActiveJobQueryError("campaign",error);}
  }));
  return pages.flat().map(rowJob)
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id))
    .slice(0,bounded);
}

export async function probeServerActiveJobPage(){
  return probeActiveJobPage(createRestClient().request);
}

export async function getServerJobByIdempotencyKey(idempotencyKey:string){
  const {request}=createRestClient();
  const rows=await request("jobs?select=*&idempotency_key=eq."+encodeURIComponent(idempotencyKey)+"&limit=1") as JsonRecord[];
  return rows?.[0]?rowJob(rows[0]):undefined;
}

export async function listRecentServerParseJobs(args:{
  since:string;limit:number;sessionId?:string;after?:{createdAt:string;id:string};
}){
  const {request}=createRestClient();
  const rows=await readRecentParseJobRows(request,args);
  return rows.map(rowJob);
}

export async function createServerJobIdempotentReceipt(
  jobInput:EvolutionJob,
  startGuard?:{kind:"html-campaign";allowSingleWaitingRetry:boolean},
){
  const job=EvolutionJobSchema.parse(jobInput);
  if(startGuard&&(job.type!=="campaign"||job.status!=="queued"||!job.missionId)){
    throw new Error("HTML Campaign start guard requires a queued Mission-bound Campaign Job");
  }
  const {request}=createRestClient();
  // HTML starts must make the active-Job check and Job/Event creation atomic in
  // Postgres. A missing migration must fail closed; NEVER fall back to the
  // generic idempotency-key-only RPC for this path.
  const rpc=startGuard?"rpc/create_evolution_html_campaign_control":"rpc/create_evolution_job_idempotent";
  const payload=startGuard?{p_job:job,p_allow_single_waiting_retry:startGuard.allowSingleWaitingRetry}:{p_job:job};
  const rows=await request(rpc,{
    method:"POST",body:JSON.stringify(payload),
  }) as Array<{applied?:unknown;reason?:unknown;job?:unknown}>;
  const result=rows?.[0];
  const current=rpcJob(result?.job);
  if(result?.applied===true&&current){
    await mirrorEvolutionEventToEvidenceLedger(createEvolutionEvent({
      id:`job-created:${current.id}`,
      missionId:current.missionId,jobId:current.id,
      type:"JobQueued",source:"backend-job-lifecycle",at:current.createdAt,
      payload:{type:current.type,label:current.label,idempotencyKey:current.idempotencyKey},
    })).catch(()=>undefined);
    return {job:current,reused:result.reason!=="created"};
  }
  throw new JobStateConflictError(job.id,typeof result?.reason==="string"?result.reason:"unknown",current);
}

export async function createServerJobIdempotent(jobInput:EvolutionJob){
  return (await createServerJobIdempotentReceipt(jobInput)).job;
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
        const rows=await listAllRowsById(request,"missions");
        const envelopes=newestFirst(rows.map(rowMissionEnvelope));
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
        const rows=await listAllRowsById(request,"jobs",filter);
        const jobs=newestFirst(rows.map(rowJob));
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
      append:async(event)=>appendServerEvent(request,event),
      list:async(missionId,limit=200)=>{
        const rows=await readServerEventRows(request,missionId,limit);
        return rows.map(rowEvent);
      },
    },
  };
}

export async function probeServerEventPage(){
  return probeEventPage(createRestClient().request);
}

export async function probeServerEventIdentityReadback(){
  return probeServerEventReadback(createRestClient().request);
}

export async function listServerEventEvidencePage(args:{missionId?:string;afterId?:string;limit:number}){
  return readEventEvidencePage(createRestClient().request,args);
}

export async function probeServerEventEvidencePage(){
  return probeEventEvidencePage(createRestClient().request);
}

export function resetServerProductionRuntime(){
  // Kept for test/API compatibility. The runtime no longer owns process-global mutable state.
}

export const SERVER_CONTROL_SCHEMA_VERSIONS={
  mission:PRODUCTION_SCHEMA_VERSIONS.mission,
  job:PRODUCTION_SCHEMA_VERSIONS.job,
  event:PRODUCTION_SCHEMA_VERSIONS.event,
} as const;
