import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {
  OutcomeMetricBatchRequestSchema,
  OutcomeMetricBatchResponseSchema,
  OutcomeMetricSampleSchema,
  type OutcomeMetricBatchRequest,
  type OutcomeMetricSample,
} from "@evolution/contracts";
import {getEvolutionWorkspaceId,getServerSupabaseConfig} from "../server-env";
import {dataPlaneFetch} from "./data-plane-http";
import {supabaseRestAuthHeaders} from "./supabase-rest-auth";

type JsonRecord=Record<string,unknown>;

export class OutcomeSampleIdConflictError extends Error{
  constructor(){
    super("Outcome sample ID is duplicated or reused with different content");
    this.name="OutcomeSampleIdConflictError";
  }
}
export class OutcomeSampleLimitExceededError extends Error{
  constructor(readonly limit:number){
    super(`Outcome analysis exceeds the ${limit} sample limit; complete evidence is required`);
    this.name="OutcomeSampleLimitExceededError";
  }
}

function db(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const baseHeaders={...supabaseRestAuthHeaders(config.anonKey),"Content-Type":"application/json"};
  return async(path:string,init:RequestInit={})=>{
    const response=await dataPlaneFetch("outcome-sample-store",root+"/"+path,{...init,headers:{...baseHeaders,...(init.headers??{})}});
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  };
}

function fromRow(row:JsonRecord):OutcomeMetricSample{
  const value=typeof row.value==="string"&&row.value.trim()
    ?Number(row.value)
    :row.value;
  return OutcomeMetricSampleSchema.parse({
    id:row.id,workspaceId:row.workspace_id,missionId:row.mission_id,
    candidateId:row.candidate_id??undefined,deploymentId:row.deployment_id??undefined,
    arm:row.arm,metricKey:row.metric_key,metricKind:row.metric_kind,direction:row.direction,
    value,unit:row.unit??undefined,segment:row.segment??"all",
    source:row.source,observedAt:row.observed_at,metadata:row.metadata??{},
  });
}

function sameSampleRow(expected:JsonRecord,actual:JsonRecord){
  const normalize=(row:JsonRecord)=>{
    const sample=fromRow(row);
    const observedMs=Date.parse(sample.observedAt);
    if(!Number.isFinite(observedMs))throw new Error("Outcome sample observedAt is invalid");
    return {...sample,observedAt:new Date(observedMs).toISOString()};
  };
  return isDeepStrictEqual(normalize(expected),normalize(actual));
}
function filterValue(value:string){
  // PostgREST requires quoted values inside a logical filter when an ID or
  // timestamp contains punctuation that also belongs to its URL grammar.
  return "%22"+encodeURIComponent(value.replace(/\\/g,"\\\\").replace(/"/g,'\\"'))+"%22";
}

function afterSample(sample:Pick<OutcomeMetricSample,"observedAt"|"id">){
  const at=filterValue(sample.observedAt);
  return "&or=(observed_at.gt."+at
    +",and(observed_at.eq."+at+",id.gt."+filterValue(sample.id)+"))";
}

function generatedOutcomeSampleId(args:{workspaceId:string;missionId:string;candidateId?:string;sample:OutcomeMetricBatchRequest["samples"][number]}){
  const observedMs=Date.parse(args.sample.observedAt);
  if(!Number.isFinite(observedMs))throw new Error("Outcome sample observedAt is invalid");
  const identity=[
    args.workspaceId,args.missionId,args.sample.candidateId??args.candidateId??null,
    args.sample.deploymentId??null,args.sample.arm,args.sample.metricKey,
    args.sample.segment,args.sample.source.trim(),new Date(observedMs).toISOString(),
  ];
  return "outcome-"+createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
export async function insertOutcomeSamples(raw:OutcomeMetricBatchRequest){
  const input=OutcomeMetricBatchRequestSchema.parse(raw);
  const workspaceId=getEvolutionWorkspaceId();
  if(!workspaceId)throw new Error("EVOLUTION_WORKSPACE_ID is required");
  const rows=input.samples.map((sample)=>({
    id:sample.id??generatedOutcomeSampleId({workspaceId,missionId:input.missionId,candidateId:input.candidateId,sample}),workspace_id:workspaceId,mission_id:input.missionId,
    candidate_id:sample.candidateId??input.candidateId??null,deployment_id:sample.deploymentId??null,
    arm:sample.arm,metric_key:sample.metricKey,metric_kind:sample.metricKind,direction:sample.direction,
    value:sample.value,unit:sample.unit??null,segment:sample.segment,source:sample.source,
    observed_at:sample.observedAt,metadata:sample.metadata,
  }));
  const expectedById=new Map<string,JsonRecord>();
  for(const row of rows){
    if(expectedById.has(row.id))throw new OutcomeSampleIdConflictError();
    expectedById.set(row.id,row);
  }
  const request=db();
  const inserted=await request("outcome_metric_samples?on_conflict=id",{
    method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(rows),
  });
  if(!Array.isArray(inserted))throw new Error("Outcome sample write response is unconfirmed");
  const insertedIds=new Set<string>();
  for(const raw of inserted){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Outcome sample write response is invalid");
    const actual=raw as JsonRecord;
    const id=actual.id;
    if(typeof id!=="string"||insertedIds.has(id)||!expectedById.has(id)){
      throw new Error("Outcome sample write response contains an unexpected ID");
    }
    if(!sameSampleRow(expectedById.get(id)!,actual))throw new OutcomeSampleIdConflictError();
    insertedIds.add(id);
  }
  const missing=rows.filter((row)=>!insertedIds.has(row.id));
  for(let offset=0;offset<missing.length;offset+=50){
    const chunk=missing.slice(offset,offset+50);
    const chunkIds=new Set(chunk.map((row)=>row.id));
    const path="outcome_metric_samples?select=*"
      +"&id=in.("+chunk.map((row)=>filterValue(row.id)).join(",")+")"
      +"&order=id.asc";
    const seen=new Set<string>();
    while(seen.size<chunk.length){
      const page=await request(path+"&limit="+(chunk.length-seen.size)+"&offset="+seen.size);
      if(!Array.isArray(page))throw new Error("Outcome sample duplicate readback is invalid");
      if(!page.length||page.length>chunk.length-seen.size){
        throw new Error("Outcome sample duplicate readback is incomplete");
      }
      for(const raw of page){
        if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Outcome sample duplicate readback is invalid");
        const actual=raw as JsonRecord;
        const id=actual.id;
        if(typeof id!=="string"||seen.has(id)||!chunkIds.has(id)){
          throw new Error("Outcome sample duplicate readback contains an unexpected ID");
        }
        if(!sameSampleRow(expectedById.get(id)!,actual))throw new OutcomeSampleIdConflictError();
        seen.add(id);
      }
    }
  }
  return OutcomeMetricBatchResponseSchema.parse({
    missionId:input.missionId,inserted:insertedIds.size,
    message:`Accepted ${rows.length} samples; inserted ${insertedIds.size} new rows.`,
  });
}

export async function readOutcomeSamples(input:{missionId:string;candidateId?:string;limit?:number;requireComplete?:boolean}){
  const workspaceId=getEvolutionWorkspaceId();
  if(!workspaceId)throw new Error("EVOLUTION_WORKSPACE_ID is required");
  const candidate=input.candidateId?"&candidate_id=eq."+encodeURIComponent(input.candidateId):"";
  const limit=Math.max(1,Math.min(input.limit??10_000,20_000));
  const request=db();
  const path="outcome_metric_samples?select=*"
    +"&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&mission_id=eq."+encodeURIComponent(input.missionId)
    +candidate+"&order=observed_at.asc,id.asc";
  const samples:OutcomeMetricSample[]=[];
  const seen=new Set<string>();
  while(samples.length<limit){
    const page=await request(path+"&limit="+Math.min(500,limit-samples.length)
      +(samples.length?afterSample(samples[samples.length-1]):""));
    if(!Array.isArray(page))throw new Error("Outcome sample page is not an array");
    if(page.length===0)break;
    if(page.length>Math.min(500,limit-samples.length))throw new Error("Outcome sample page exceeds the requested limit");
    for(const raw of page){
      if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Outcome sample row is invalid");
      const sample=fromRow(raw as JsonRecord);
      if(sample.workspaceId!==workspaceId||sample.missionId!==input.missionId
        ||input.candidateId&&sample.candidateId!==input.candidateId){
        throw new Error("Outcome sample row does not match the requested scope");
      }
      if(seen.has(sample.id))throw new Error("Outcome sample page repeated an id");
      seen.add(sample.id);
      samples.push(sample);
    }
  }
  if(input.requireComplete&&samples.length===limit){
    const extra=await request(path.replace("select=*","select=id")+"&limit=1"
      +afterSample(samples[samples.length-1]));
    if(!Array.isArray(extra))throw new Error("Outcome sample overflow probe is not an array");
    if(extra.length)throw new OutcomeSampleLimitExceededError(limit);
  }
  return samples;
}

export async function probeOutcomeSampleStore(){
  await db()("outcome_metric_samples?select=id"
    +"&workspace_id=eq.health-probe&mission_id=eq.health-probe"
    +"&order=observed_at.asc,id.asc&limit=1"
    +afterSample({observedAt:"2026-01-01T00:00:00Z",id:"health-probe"}));
  return true;
}
