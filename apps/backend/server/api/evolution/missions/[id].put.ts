import {createError,defineEventHandler,getRouterParam,readBody} from "nitro/h3";
import {MissionEnvelopeSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Mission id"});
  const envelope=MissionEnvelopeSchema.parse(await readBody(event));
  if(envelope.missionId!==id||envelope.payload.id!==id){
    throw createError({statusCode:409,statusMessage:"Mission path id 与 payload 不一致"});
  }
  await getServerProductionRuntime().missions.save(envelope.payload);
  return {ok:true,missionId:id};
});
