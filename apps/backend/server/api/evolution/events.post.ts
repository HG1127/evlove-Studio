import {createError,defineEventHandler,readBody} from "nitro/h3";
import {EvolutionEventSchema} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError} from "../../../src/services/evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError,EventReadbackError} from "../../../src/services/event-persistence";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  const value=EvolutionEventSchema.parse(await readBody(event));
  try{await getServerProductionRuntime().events.append(value);}
  catch(error){
    if(error instanceof EventIdempotencyConflictError||error instanceof EventEvidenceIdentityConflictError){
      throw createError({statusCode:409,statusMessage:"Event identity conflict",data:{code:"EVENT_IDEMPOTENCY_CONFLICT",message:"运行记录存在内容冲突，已保留现有记录。请刷新项目后重试。"}});
    }
    if(error instanceof EventEvidenceMirrorError){
      throw createError({statusCode:503,statusMessage:"Event Evidence mirror unavailable",data:{code:error.code,message:"事件已保存，验证记录同步未完成；系统将使用同一事件 ID 重试。"}});
    }
    if(error instanceof EventReadbackError){
      throw createError({statusCode:503,statusMessage:"Event readback unavailable",data:{code:error.code,message:error.message}});
    }
    throw error;
  }
  return {ok:true,eventId:value.id};
});
