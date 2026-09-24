import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {readSourceParseResult} from "../../../src/services/source-parse-result";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const id=String(getQuery(event).id??"").trim();
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 parse job id"});
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(id);
  if(!job||job.type!=="parse")throw createError({statusCode:404,statusMessage:"Parse Job 不存在"});
  return readSourceParseResult(job,getServerArtifactStore());
});
