import type {EvolveProject} from "@evolution/contracts";
import {runServerReleaseReconciliation} from "@evolution/harness";
import {observeVercelReleaseReality} from "./vercel-release";

export async function runServerMissionReleaseReconciliation(project:EvolveProject){
  return runServerReleaseReconciliation(project,{
    observe:({boundDeploymentId,healthPath})=>observeVercelReleaseReality({boundDeploymentId,healthPath}),
  });
}
