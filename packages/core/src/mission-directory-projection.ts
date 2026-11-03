import type {MissionHeader} from "@evolution/contracts";
/** Full loaded state wins; directory metadata cannot revive a local deletion. */
export function selectUnloadedMissionHeaders(headers:readonly MissionHeader[],loadedIds:ReadonlySet<string>,removedIds:ReadonlySet<string>){
 return headers.filter(header=>!loadedIds.has(header.missionId)&&!removedIds.has(header.missionId));
}
