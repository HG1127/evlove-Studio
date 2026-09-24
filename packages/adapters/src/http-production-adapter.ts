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
  filters:Record<string,string>={},
){
  const items:T[]=[];
  const seen=new Set<string>();
  let cursor:string|undefined;
  for(;;){
    const params=new URLSearchParams({...filters,pageLimit:"100"});
    if(cursor)params.set("cursor",cursor);
    const page=await json(await fetch(`${root}/${path}?${params}`),parse);
    items.push(...page.items);
    if(!page.nextCursor)return items;
    if(page.items.length===0||seen.has(page.nextCursor))throw new Error(`Invalid ${path} page cursor`);
    seen.add(page.nextCursor);
    cursor=page.nextCursor;
  }
}

const MissionPageSchema=z.object({items:MissionEnvelopeSchema.array(),nextCursor:z.string().optional()});
const JobPageSchema=z.object({items:EvolutionJobSchema.array(),nextCursor:z.string().optional()});

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
        const envelopes=await listPages(root,"missions",MissionPageSchema.parse);
        const remoteIds=new Set(envelopes.map((item)=>item.missionId));
        for(const item of envelopes)missionRevisions.set(item.missionId,item.revision);
        for(const id of [...missionRevisions.keys()])if(!remoteIds.has(id))missionRevisions.delete(id);
        return envelopes.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map((item)=>item.payload);
      },
      get:async(id)=>{
        const res=await fetch(`${root}/missions/${encodeURIComponent(id)}`);
        if(res.status===404){missionRevisions.delete(id);return undefined;}
        const envelope=await json(res,(value)=>MissionEnvelopeSchema.parse(value));
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
        const saved=await json(res,(value)=>MissionEnvelopeSchema.parse(value));
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
        await expectOk(res,"Mission delete failed");
        missionRevisions.delete(id);
      },
      flush:async()=>undefined,
    },
    jobs:{
      list:async(missionId)=>{
        const jobs=await listPages(root,"jobs",JobPageSchema.parse,missionId?{missionId}:{});
        return jobs.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      },
      get:async(id)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}`);if(res.status===404)return undefined;return json(res,EvolutionJobSchema.parse);},
      put:async(job)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(job.id)}`,{method:"PUT",headers:headers(),body:JSON.stringify(EvolutionJobSchema.parse(job))});await expectOk(res,"Job save failed");},
      cancel:async(id)=>{
        const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}/cancel`,{method:"POST"});
        await json(res,EvolutionJobCancelResponseSchema.parse);
      },
    },
    events:{
      append:async(event)=>{const res=await fetch(`${root}/events`,{method:"POST",headers:headers(),body:JSON.stringify(EvolutionEventSchema.parse(event))});await expectOk(res,"Event append failed");},
      list:async(missionId,limit=200)=>{
        const params=new URLSearchParams();if(missionId)params.set("missionId",missionId);params.set("limit",String(limit));
        const res=await fetch(`${root}/events?${params.toString()}`);
        return json(res,(value)=>EvolutionEventSchema.array().parse(Array.isArray(value)?value:(value as {items?:unknown}).items??[]));
      },
    },
    artifacts:{
      put:async(id,blob)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":blob.type||"application/octet-stream"},body:blob});await expectOk(res,"Artifact upload failed");},
      get:async(id)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`);if(res.status===404)return undefined;await expectOk(res,"Artifact get failed");return res.blob();},
      delete:async(id)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`,{method:"DELETE"});if(res.status!==404)await expectOk(res,"Artifact delete failed");},
    },
  };
}
