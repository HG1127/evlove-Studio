import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {z} from "zod";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";

const EventListQuerySchema=z.object({
  missionId:z.string().trim().min(1).max(200).optional(),
  limit:z.string().regex(/^[1-9][0-9]{0,3}$/).transform(Number).pipe(z.number().int().max(1000)).optional(),
});

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  requireServerDataPlaneAvailable();
  const query=EventListQuerySchema.safeParse(getQuery(event));
  if(!query.success)throw createError({statusCode:400,statusMessage:"Invalid Event list query"});
  return getServerProductionRuntime().events.list(query.data.missionId,query.data.limit??200);
});
