import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {SourceParseListQuerySchema} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {listRecentServerParseJobs} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {readSourceParseResults} from "../../../src/services/source-parse-result";

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
  return {items:await readSourceParseResults(jobs,artifacts)};
});
