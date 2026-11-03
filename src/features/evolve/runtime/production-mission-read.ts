import {directoryRemovedMissionIds,getLocalProject} from "./local-store";
import {getProductionRuntime,productionRuntimeMode} from "./production-runtime";
import {cachePointMissionProjection} from "./production-sync";
/** Point reads use the complete Mission port; directory headers never enter storage. */
export async function readProductionMission(id:string,signal?:AbortSignal){
 if(signal?.aborted||directoryRemovedMissionIds().has(id))return undefined;
 if(productionRuntimeMode()==="local")return getLocalProject(id);
 const remote=await getProductionRuntime().missions.get(id);
 if(signal?.aborted||directoryRemovedMissionIds().has(id))return undefined;
 return cachePointMissionProjection(id,remote);
}
