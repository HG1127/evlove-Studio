import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  MissionEnvelopeSchema,
  missionEnvelope,
  type ProductionRuntimePorts,
} from "@evolution/contracts";

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

export function createHttpProductionPorts(apiUrl:string):ProductionRuntimePorts{
  const root=baseUrl(apiUrl);
  return {
    missions:{
      initialize:async()=>undefined,
      list:async()=>{
        const res=await fetch(`${root}/missions`);
        const envelopes=await json(res,(value)=>MissionEnvelopeSchema.array().parse(Array.isArray(value)?value:(value as {items?:unknown}).items??[]));
        return envelopes.map((item)=>item.payload);
      },
      get:async(id)=>{
        const res=await fetch(`${root}/missions/${encodeURIComponent(id)}`);
        if(res.status===404)return undefined;
        return (await json(res,(value)=>MissionEnvelopeSchema.parse(value))).payload;
      },
      save:async(project)=>{
        const res=await fetch(`${root}/missions/${encodeURIComponent(project.id)}`,{method:"PUT",headers:headers(),body:JSON.stringify(missionEnvelope(project))});
        await expectOk(res,"Mission save failed");
      },
      delete:async(id)=>{const res=await fetch(`${root}/missions/${encodeURIComponent(id)}`,{method:"DELETE"});if(res.status!==404)await expectOk(res,"Mission delete failed");},
      flush:async()=>undefined,
    },
    jobs:{
      list:async(missionId)=>{
        const query=missionId?`?missionId=${encodeURIComponent(missionId)}`:"";
        const res=await fetch(`${root}/jobs${query}`);
        return json(res,(value)=>EvolutionJobSchema.array().parse(Array.isArray(value)?value:(value as {items?:unknown}).items??[]));
      },
      get:async(id)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}`);if(res.status===404)return undefined;return json(res,EvolutionJobSchema.parse);},
      put:async(job)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(job.id)}`,{method:"PUT",headers:headers(),body:JSON.stringify(EvolutionJobSchema.parse(job))});await expectOk(res,"Job save failed");},
      cancel:async(id)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}/cancel`,{method:"POST"});await expectOk(res,"Job cancel failed");},
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
