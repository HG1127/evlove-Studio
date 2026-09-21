import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {SourceArtifactSchema,SourceParseStatusResponseSchema} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const id=String(getQuery(event).id??"").trim();
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 parse job id"});
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(id);
  if(!job||job.type!=="parse")throw createError({statusCode:404,statusMessage:"Parse Job 不存在"});
  let artifact;
  if(job.status==="completed"&&job.outputRef){
    const blob=await getServerArtifactStore().get(job.outputRef);
    if(!blob)throw createError({statusCode:500,statusMessage:"Parse Job 已完成，但结果 Artifact 不存在"});
    try{
      artifact=SourceArtifactSchema.parse(JSON.parse(await blob.text()));
    }catch{
      throw createError({statusCode:500,statusMessage:"Parse Job 结果 Artifact 已损坏或 schema 不兼容"});
    }
  }
  if(job.status==="completed"&&!artifact)throw createError({statusCode:500,statusMessage:"Parse Job 已完成，但没有可读取的解析结果"});
  return SourceParseStatusResponseSchema.parse({job,artifact});
});
