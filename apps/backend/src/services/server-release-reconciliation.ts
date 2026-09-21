import type {EvolveProject} from "@evolution/contracts";
import {runServerReleaseReconciliation} from "@evolution/harness";
import {observeVercelReleaseReality} from "./vercel-release";
import {recordReleaseOutcomeObservation} from "./release-outcome-telemetry";

export async function runServerMissionReleaseReconciliation(project:EvolveProject){
  let observed:Awaited<ReturnType<typeof observeVercelReleaseReality>>|undefined;
  const outcome=await runServerReleaseReconciliation(project,{
    observe:async({boundDeploymentId,healthPath})=>{
      observed=await observeVercelReleaseReality({boundDeploymentId,healthPath});
      return observed;
    },
  });
  if(observed){
    await recordReleaseOutcomeObservation(project,observed).catch(()=>undefined);
  }
  return outcome;
}
