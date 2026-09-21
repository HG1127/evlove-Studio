import type {EvolveProject} from "@evolution/contracts";
import {runServerReleaseReconciliation} from "@evolution/harness";
import {observeVercelReleaseReality} from "./vercel-release";
import {recordReleaseOutcomeObservation} from "./release-outcome-telemetry";

export async function runServerMissionReleaseReconciliation(project:EvolveProject){
  let observed:Awaited<ReturnType<typeof observeVercelReleaseReality>>|undefined;
  const outcome=await runServerReleaseReconciliation(project,{
    observe:async({boundDeploymentId,healthPath})=>{
      observed=await observeVercelReleaseReality({
        boundDeploymentId,
        gitCommitSha:project.release.sourceGitCommitSha,
        healthPath,
      });
      return observed;
    },
  });
  if(observed){
    const recorded=await recordReleaseOutcomeObservation(outcome.project,observed).catch(()=>undefined);
    if(recorded?.telemetry?.warnings.length){
      console.warn("[outcome-telemetry] release observation completed with warnings",recorded.telemetry.warnings);
    }
  }
  return outcome;
}
