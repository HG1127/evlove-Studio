import {defineEventHandler,readBody} from "nitro/h3";
import {EvolutionEventSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const value=EvolutionEventSchema.parse(await readBody(event));
  await getServerProductionRuntime().events.append(value);
  return {ok:true,eventId:value.id};
});
