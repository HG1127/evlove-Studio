import {createError,defineEventHandler,getRouterParam} from "nitro/h3";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const id=getRouterParam(event,"id");
  if(!id)throw createError({statusCode:400,statusMessage:"缺少 Mission id"});
  await getServerProductionRuntime().missions.delete(id);
  return {ok:true,missionId:id};
});
