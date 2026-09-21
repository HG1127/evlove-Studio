import {defineEventHandler,getQuery} from "nitro/h3";
import {SourceArtifactSchema,SourceParseListResponseSchema} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";

const TTL_MS=7*24*60*60*1000;

export default defineEventHandler(async(event)=>{
  const sessionId=String(getQuery(event).sessionId??"").trim();
  const runtime=getServerProductionRuntime();
  const artifacts=getServerArtifactStore();
  const lower=Date.now()-TTL_MS;
  const jobs=(await runtime.jobs.list())
    .filter((job)=>job.type==="parse"
      &&Date.parse(job.updatedAt)>=lower
      &&(!sessionId||job.metadata?.sessionId===sessionId))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    .slice(0,60);
  const items=[];
  for(const job of jobs){
    let artifact;
    if(job.status==="completed"&&job.outputRef){
      const blob=await artifacts.get(job.outputRef).catch(()=>undefined);
      if(blob){
        try{artifact=SourceArtifactSchema.parse(JSON.parse(await blob.text()));}catch{/* leave undefined */}
      }
    }
    if(job.status==="completed"&&!artifact){
      items.push({job:{...job,status:"failed",error:"Parse 结果 Artifact 缺失或损坏"},artifact:undefined});
      continue;
    }
    items.push({job,artifact});
  }
  return SourceParseListResponseSchema.parse({items});
});
