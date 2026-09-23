import {createError,defineEventHandler,getRouterParam,readBody} from "nitro/h3";
import {MissionEnvelopeSchema} from "@evolution/contracts";
import {
  compareAndSwapServerMissionEnvelope,
  getServerMissionEnvelope,
  MissionRevisionConflictError,
} from "../../../../src/services/production-runtime";
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
  const current=await getServerMissionEnvelope(id);
  if(current){
    try{assertClientMissionMutationSafe(current.payload,envelope.payload);}
    catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});}
  }
  try{
    return await compareAndSwapServerMissionEnvelope(envelope);
  }catch(error){
    if(error instanceof MissionRevisionConflictError){
      throw createError({
        statusCode:409,
        statusMessage:error.message,
        data:{
          code:error.code,
          missionId:error.missionId,
          expectedRevision:error.expectedRevision,
          currentRevision:error.currentRevision,
        },
      });
    }
    throw error;
  }
});
