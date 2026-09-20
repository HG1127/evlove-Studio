import { createSupabaseProductionPorts } from "@evolution/adapters";
import type { ArtifactStorePort } from "@evolution/contracts";
import { getServerSupabaseConfig } from "../server-env";

let artifacts:ArtifactStorePort|undefined;

export function getServerArtifactStore():ArtifactStorePort{
  if(artifacts)return artifacts;
  artifacts=createSupabaseProductionPorts(getServerSupabaseConfig()).artifacts;
  return artifacts;
}
