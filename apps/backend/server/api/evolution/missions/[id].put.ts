import {createError,defineEventHandler,getRouterParam,readBody} from "nitro/h3";
import {MissionEnvelopeSchema} from "@evolution/contracts";
import {
  compareAndSwapServerMissionEnvelope,
  getServerMissionEnvelope,
  MissionRevisionConflictError,
} from "../../../../src/services/production-runtime";
import {assertClientMissionMutationSafe} from "../../../../src/services/mission-mutation-policy";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";
import {assertServerConfirmationAdmission} from "../../../../src/services/server-confirmation-admission";
import {assertLabSyntheticInitialSource,assertLabSyntheticSourceMutation} from "../../../../src/services/lab-html-original-custody";

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
    try{await assertLabSyntheticSourceMutation(current.payload,envelope.payload);}
    catch{throw createError({statusCode:409,statusMessage:"隔离合成 Mission 的源文件绑定或物理证据无效",data:{code:"LAB_SYNTHETIC_SOURCE_BINDING_UNVERIFIED"}});}
  }else {
    try{assertLabSyntheticInitialSource(envelope.payload);}
    catch{throw createError({statusCode:422,statusMessage:"隔离合成 Mission 不能以未核验文件关联直接创建",data:{code:"LAB_SYNTHETIC_SOURCE_PREREGISTRATION_INVALID"}});}
    await assertServerConfirmationAdmission(envelope.payload,"registration");
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
