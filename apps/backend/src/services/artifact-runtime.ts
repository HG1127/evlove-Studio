import { createSupabaseProductionPorts } from "@evolution/adapters";
import type { ArtifactStorePort } from "@evolution/contracts";
import { getServerSupabaseConfig } from "../server-env";
import {assertServerControlExecutionActive} from "./server-control-execution";

let artifacts:ArtifactStorePort|undefined;

export function getServerArtifactStore():ArtifactStorePort{
  artifacts??=createSupabaseProductionPorts(getServerSupabaseConfig()).artifacts;
  const store=artifacts;
  return {...store,put:async(id,blob,metadata)=>{
    await assertServerControlExecutionActive(metadata?.missionId);
    return store.put(id,blob,metadata);
  }};
}
