import {createError,defineEventHandler,getRouterParam,readBody} from "nitro/h3";
import {MissionEnvelopeSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";
import {assertClientMissionMutationSafe} from "../../../../src/services/mission-mutation-policy";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Mission id"});
  const envelope=MissionEnvelopeSchema.parse(await readBody(event));
  if(envelope.missionId!==id||envelope.payload.id!==id){
    throw createError({statusCode:409,statusMessage:"Mission path id 与 payload 不一致"});
  }
  const runtime=getServerProductionRuntime();
  const current=await runtime.missions.get(id);
  if(current){
    try{assertClientMissionMutationSafe(current,envelope.payload);}
    catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});}
  }
  await runtime.missions.save(envelope.payload);
  return {ok:true,missionId:id};
});
