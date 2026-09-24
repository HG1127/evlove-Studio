import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {SourceArtifactSchema,SourceParseListQuerySchema,SourceParseListResponseSchema} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {listRecentServerParseJobs} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

const TTL_MS=7*24*60*60*1000;

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=SourceParseListQuerySchema.safeParse(getQuery(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Parse Job list query"});
  const sessionId=parsed.data.sessionId;
  const artifacts=getServerArtifactStore();
  const jobs=await listRecentServerParseJobs({
    since:new Date(Date.now()-TTL_MS).toISOString(),limit:60,sessionId,
  });
  const items=[];
  for(const job of jobs){
    let artifact;
    let resultIssue:string|undefined;
    if(job.status==="completed"&&job.outputRef){
      const blob=await artifacts.get(job.outputRef).catch(()=>{
        resultIssue="Parse 结果 Artifact 暂时不可读取";
        return undefined;
      });
      if(blob){
        try{artifact=SourceArtifactSchema.parse(JSON.parse(await blob.text()));}
        catch{resultIssue="Parse 结果 Artifact 已损坏或 schema 不兼容";}
      }
    }
    if(job.status==="completed"&&!artifact){
      items.push({job,resultIssue:resultIssue??"Parse 结果 Artifact 缺失"});
      continue;
    }
    items.push({job,artifact});
  }
  return SourceParseListResponseSchema.parse({items});
});
