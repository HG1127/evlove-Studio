import {defineEventHandler,readBody} from "nitro/h3";
import {EvolutionEventSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"mission.write");
  const value=EvolutionEventSchema.parse(await readBody(event));
  await getServerProductionRuntime().events.append(value);
  return {ok:true,eventId:value.id};
});
