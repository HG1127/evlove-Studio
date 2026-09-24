import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EvolveProjectSchema} from "@evolution/contracts";
import {createServerMissionEnvelope} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireServerDataPlaneAvailable} from "../../../src/services/data-plane-guard";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  requireServerDataPlaneAvailable();
  const parsed=EvolveProjectSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Mission request",data:parsed.error.flatten()});
  return createServerMissionEnvelope(parsed.data);
});
