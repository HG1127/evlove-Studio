import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  MissionEnvelopeSchema,
  missionEnvelope,
  type ProductionRuntimePorts,
} from "@evolution/contracts";

function baseUrl(value:string){return value.replace(/\/+$/,"");}
async function json<T>(res:Response,parse:(value:unknown)=>T){if(!res.ok)throw new Error(`Production API HTTP ${res.status}`);return parse(await res.json());}
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
        if(!res.ok)throw new Error(`Mission save failed: HTTP ${res.status}`);
      },
      delete:async(id)=>{const res=await fetch(`${root}/missions/${encodeURIComponent(id)}`,{method:"DELETE"});if(!res.ok&&res.status!==404)throw new Error(`Mission delete failed: HTTP ${res.status}`);},
      flush:async()=>undefined,
    },
    jobs:{
      list:async(missionId)=>{
        const query=missionId?`?missionId=${encodeURIComponent(missionId)}`:"";
        const res=await fetch(`${root}/jobs${query}`);
        return json(res,(value)=>EvolutionJobSchema.array().parse(Array.isArray(value)?value:(value as {items?:unknown}).items??[]));
      },
      get:async(id)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}`);if(res.status===404)return undefined;return json(res,EvolutionJobSchema.parse);},
      put:async(job)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(job.id)}`,{method:"PUT",headers:headers(),body:JSON.stringify(EvolutionJobSchema.parse(job))});if(!res.ok)throw new Error(`Job save failed: HTTP ${res.status}`);},
      cancel:async(id)=>{const res=await fetch(`${root}/jobs/${encodeURIComponent(id)}/cancel`,{method:"POST"});if(!res.ok)throw new Error(`Job cancel failed: HTTP ${res.status}`);},
    },
    events:{
      append:async(event)=>{const res=await fetch(`${root}/events`,{method:"POST",headers:headers(),body:JSON.stringify(EvolutionEventSchema.parse(event))});if(!res.ok)throw new Error(`Event append failed: HTTP ${res.status}`);},
      list:async(missionId,limit=200)=>{
        const params=new URLSearchParams();if(missionId)params.set("missionId",missionId);params.set("limit",String(limit));
        const res=await fetch(`${root}/events?${params.toString()}`);
        return json(res,(value)=>EvolutionEventSchema.array().parse(Array.isArray(value)?value:(value as {items?:unknown}).items??[]));
      },
    },
    artifacts:{
      put:async(id,blob)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":blob.type||"application/octet-stream"},body:blob});if(!res.ok)throw new Error(`Artifact upload failed: HTTP ${res.status}`);},
      get:async(id)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`);if(res.status===404)return undefined;if(!res.ok)throw new Error(`Artifact get failed: HTTP ${res.status}`);return res.blob();},
      delete:async(id)=>{const res=await fetch(`${root}/artifacts/${encodeURIComponent(id)}`,{method:"DELETE"});if(!res.ok&&res.status!==404)throw new Error(`Artifact delete failed: HTTP ${res.status}`);},
    },
  };
}
