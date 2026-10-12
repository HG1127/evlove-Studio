import {missionEnvelope,type EvolveProject,type MissionEnvelope} from "@evolution/contracts";
import {MissionRevisionConflictError} from "./production-runtime";

/** Test-only memory repository: snapshots and real revision compare-and-swap semantics. */
export function workflowControlTestStore(project:EvolveProject){
  let envelope=missionEnvelope(structuredClone(project),29);
  return {
    read:async(id:string)=>id===envelope.missionId?structuredClone(envelope):undefined,
    save:async(next:MissionEnvelope)=>{
      if(next.missionId!==envelope.missionId||next.revision!==envelope.revision)
        throw new MissionRevisionConflictError(next.missionId,next.revision,envelope.revision);
      envelope={...structuredClone(next),revision:next.revision+1};
      return structuredClone(envelope);
    },
    current:()=>structuredClone(envelope.payload),
    replace:(next:EvolveProject)=>{envelope={...envelope,payload:structuredClone(next),updatedAt:next.updatedAt,revision:envelope.revision+1};},
    revision:()=>envelope.revision,
  };
}
