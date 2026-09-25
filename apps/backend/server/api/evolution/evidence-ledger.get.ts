import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {z} from "zod";
import {listEvidenceLedger} from "../../../src/services/evidence-ledger";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const query=getQuery(event);
  const missionId=typeof query.missionId==="string"?query.missionId.trim():"";
  if(!missionId)throw createError({statusCode:400,statusMessage:"missionId is required"});
  const limit=Math.max(1,Math.min(Number(query.limit??500)||500,2000));
  const rawCursor=query.afterSequence;
  const parsedCursor=rawCursor===undefined?{success:true as const,data:0}
    :z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).refine(Number.isSafeInteger).safeParse(rawCursor);
  if(!parsedCursor.success)throw createError({statusCode:400,statusMessage:"afterSequence must be a nonnegative safe integer"});
  return {missionId,entries:await listEvidenceLedger(missionId,limit,parsedCursor.data)};
});
