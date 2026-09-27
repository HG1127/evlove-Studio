import {
  EvolutionEventSchema,
  EvolutionJobCancelResponseSchema,
  EvolutionJobSchema,
  MissionEnvelopeSchema,
  missionEnvelope,
  type ProductionRuntimePorts,
} from "@evolution/contracts";
import {z} from "zod";

function baseUrl(value:string){return value.replace(/\/+$/,"");}
function safeErrorDetail(value:unknown){
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const record=value as Record<string,unknown>;
  for(const key of ["statusMessage","message","error"]){
    const detail=record[key];
    if(typeof detail==="string"&&detail.trim())return detail.trim().slice(0,300);
  }
  return undefined;
}
async function httpError(res:Response,context:string){
  let detail:string|undefined;
  try{
    const contentType=res.headers.get("content-type")??"";
    if(contentType.includes("json"))detail=safeErrorDetail(await res.clone().json());
    else{
      const text=(await res.clone().text()).trim();
      if(text)detail=text.slice(0,300);
    }
  }catch{ /* Preserve status-only error when the response body is unreadable. */ }
  return new Error(`${context} HTTP ${res.status}${detail?`: ${detail}`:""}`);
}
async function expectOk(res:Response,context:string){if(!res.ok)throw await httpError(res,context);}
async function json<T>(res:Response,parse:(value:unknown)=>T){await expectOk(res,"Production API");return parse(await res.json());}
function headers(extra:Record<string,string>={}){return {"Content-Type":"application/json",...extra};}

async function listPages<T>(
  root:string,path:string,parse:(value:unknown)=>{items:T[];nextCursor?:string},
  identity:(item:T)=>string,filters:Record<string,string>={},
){
  const items:T[]=[];
  const seen=new Set<string>();
  const seenItems=new Set<string>();
  let cursor:string|undefined;
  for(;;){
    const params=new URLSearchParams({...filters,pageLimit:"100"});
    if(cursor)params.set("cursor",cursor);
    const page=await json(await fetch(`${root}/${path}?${params}`),parse);
    for(const item of page.items){
      const id=identity(item);
      if(seenItems.has(id))throw new Error(`Duplicate ${path} page item ${id}`);
      seenItems.add(id);
      items.push(item);
    }
    if(!page.nextCursor)return items;
    if(page.items.length===0||seen.has(page.nextCursor))throw new Error(`Invalid ${path} page cursor`);
    seen.add(page.nextCursor);
    cursor=page.nextCursor;
  }
}

const MissionHttpEnvelopeSchema=MissionEnvelopeSchema.refine((envelope)=>envelope.payload.id===envelope.missionId,"Mission envelope identity mismatch");
const MissionPageSchema=z.object({items:MissionHttpEnvelopeSchema.array(),nextCursor:z.string().min(1).optional()});
const JobPageSchema=z.object({items:EvolutionJobSchema.array(),nextCursor:z.string().min(1).optional()});
const EventListSchema=z.union([EvolutionEventSchema.array(),z.object({items:EvolutionEventSchema.array()})]);
const JobWriteReceiptSchema=z.object({ok:z.literal(true),jobId:z.string().min(1)});
const EventWriteReceiptSchema=z.object({ok:z.literal(true),eventId:z.string().min(1)});
const ArtifactWriteReceiptSchema=z.object({ok:z.literal(true),artifactId:z.string().min(1),size:z.number().int().nonnegative()});
const ArtifactDeleteReceiptSchema=z.object({ok:z.literal(true),artifactId:z.string().min(1)});
const MissionDeleteReceiptSchema=z.object({ok:z.literal(true),missionId:z.string().min(1)});

function assertReceiptIdentity(actual:string,expected:string,context:string){
  if(actual!==expected)throw new Error(`${context} receipt identity mismatch`);
}

export class MissionRevisionConflictError extends Error{
  readonly code="MISSION_REVISION_CONFLICT";
  readonly missionId:string;
  readonly expectedRevision:number;
  constructor(missionId:string,expectedRevision:number,message?:string){
    super(message??`Mission ${missionId} revision conflict at expected revision ${expectedRevision}`);
    this.name="MissionRevisionConflictError";
    this.missionId=missionId;
    this.expectedRevision=expectedRevision;
  }
}

export function createHttpProductionPorts(apiUrl:string):ProductionRuntimePorts{
  const root=baseUrl(apiUrl);
  const missionRevisions=new Map<string,number>();
  return {
    missions:{
      initialize:async()=>undefined,
      list:async()=>{
        const envelopes=await listPages(root,"missions",MissionPageSchema.parse,(item)=>item.missionId);
        const remoteIds=new Set(envelopes.map((item)=>item.missionId));
        for(const item of envelopes)missionRevisions.set(item.missionId,item.revision);
        for(const id of [...missionRevisions.keys()])if(!remoteIds.has(id))missionRevisions.delete(id);
        return envelopes.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map((item)=>item.payload);
      },
      get:async(id)=>{
        const res=await fetch(`${root}/missions/${encodeURIComponent(id)}`);
        if(res.status===404){missionRevisions.delete(id);return undefined;}
        const envelope=await json(res,(value)=>MissionHttpEnvelopeSchema.parse(value));
        assertReceiptIdentity(envelope.missionId,id,"Mission get");
        missionRevisions.set(id,envelope.revision);
        return envelope.payload;
      },
      save:async(project)=>{
        const expectedRevision=missionRevisions.get(project.id)??0;
        const res=await fetch(`${root}/missions/${encodeURIComponent(project.id)}`,{
          method:"PUT",
          headers:headers(),
          body:JSON.stringify(missionEnvelope(project,expectedRevision)),
        });
        if(res.status===409){
          const error=await httpError(res,"Mission save failed");
          throw new MissionRevisionConflictError(project.id,expectedRevision,error.message);
        }
        const saved=await json(res,(value)=>MissionHttpEnvelopeSchema.parse(value));
        assertReceiptIdentity(saved.missionId,project.id,"Mission save");
        missionRevisions.set(project.id,saved.revision);
      },
      delete:async(id)=>{
        const expectedRevision=missionRevisions.get(id)??0;
        const res=await fetch(`${root}/missions/${encodeURIComponent(id)}`,{
          method:"DELETE",
          headers:{"If-Match":`"${expectedRevision}"`},
        });
        if(res.status===404){missionRevisions.delete(id);return;}
        if(res.status===409){
          const error=await httpError(res,"Mission delete failed");
          throw new MissionRevisionConflictError(id,expectedRevision,error.message);
        }
        const receipt=await json(res,MissionDeleteReceiptSchema.parse);
        assertReceiptIdentity(receipt.missionId,id,"Mission delete");
        missionRevisions.delete(id);
      },
      flush:async()=>undefined,
    },
    jobs:{
      list:async(missionId)=>{
        const jobs=await listPages(root,"jobs",JobPageSchema.parse,(item)=>item.id,missionId?{missionId}:{});
        return jobs.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      },
      get:async(id)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}`);if(res.status===404)return undefined;const job=await json(res,EvolutionJobSchema.parse);assertReceiptIdentity(job.id,id,"Job get");return job;},
      put:async(job)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(job.id)}`,{method:"PUT",headers:headers(),body:JSON.stringify(EvolutionJobSchema.parse(job))});const receipt=await json(res,JobWriteReceiptSchema.parse);assertReceiptIdentity(receipt.jobId,job.id,"Job save");},
      cancel:async(id)=>{
        const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}/cancel`,{method:"POST"});
        const receipt=await json(res,EvolutionJobCancelResponseSchema.parse);
        assertReceiptIdentity(receipt.jobId,id,"Job cancel");
      },
    },
    events:{
      append:async(event)=>{const res=await fetch(`${root}/events`,{method:"POST",headers:headers(),body:JSON.stringify(EvolutionEventSchema.parse(event))});const receipt=await json(res,EventWriteReceiptSchema.parse);assertReceiptIdentity(receipt.eventId,event.id,"Event append");},
      list:async(missionId,limit=200)=>{
        const params=new URLSearchParams();if(missionId)params.set("missionId",missionId);params.set("limit",String(limit));
        const res=await fetch(`${root}/events?${params.toString()}`);
        return json(res,(value)=>{const events=EventListSchema.parse(value);return Array.isArray(events)?events:events.items;});
      },
    },
    artifacts:{
      put:async(id,blob)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":blob.type||"application/octet-stream"},body:blob});const receipt=await json(res,ArtifactWriteReceiptSchema.parse);assertReceiptIdentity(receipt.artifactId,id,"Artifact upload");if(receipt.size!==blob.size)throw new Error("Artifact upload receipt size mismatch");},
      get:async(id)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`);if(res.status===404)return undefined;await expectOk(res,"Artifact get failed");return res.blob();},
      delete:async(id)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`,{method:"DELETE"});if(res.status!==404){const receipt=await json(res,ArtifactDeleteReceiptSchema.parse);assertReceiptIdentity(receipt.artifactId,id,"Artifact delete");}},
    },
  };
}
