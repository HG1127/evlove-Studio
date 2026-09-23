import {createError,defineEventHandler,getHeader,getRouterParam} from "nitro/h3";
import {
  deleteServerMissionIfRevision,
  MissionRevisionConflictError,
} from "../../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Mission id"});
  const raw=getHeader(event,"if-match");
  if(!raw)throw createError({statusCode:428,statusMessage:"Mission delete requires If-Match revision"});
  const normalized=raw.trim().replace(/^W\//i,"").replace(/^"|"$/g,"");
  const expectedRevision=Number(normalized);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0){
    throw createError({statusCode:400,statusMessage:"Invalid Mission If-Match revision"});
  }
  try{
    await deleteServerMissionIfRevision(id,expectedRevision);
    return {ok:true,missionId:id};
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
