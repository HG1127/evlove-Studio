import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {JobReadQuerySchema} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {readSourceParseResult} from "../../../src/services/source-parse-result";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const parsed=JobReadQuerySchema.safeParse(getQuery(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"无效的 parse job id"});
  const id=parsed.data.id;
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(id);
  if(!job||job.type!=="parse")throw createError({statusCode:404,statusMessage:"Parse Job 不存在"});
  return readSourceParseResult(job,getServerArtifactStore());
});
