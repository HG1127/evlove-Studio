import type {EvolveProject,ReleaseAdapterResult} from "@evolution/contracts";
import {currentReleaseCandidate,projectUsesHttpRelease} from "@evolution/core";
import {runServerReleaseOrchestration,type ServerReleasePorts} from "@evolution/harness";
import {releaseHttpTarget} from "./http-target-gateway";
import {getActiveReleaseApprovalGrant} from "./release-approval-store";
import {recordHttpReleaseOutcomeObservation} from "./release-outcome-telemetry";
import {executeVercelReleaseAction} from "./vercel-release";

export async function executeServerReleaseProvider(
  project:EvolveProject,
  args:Parameters<ServerReleasePorts["execute"]>[0],
){
  if(projectUsesHttpRelease(project)){
    const candidate=currentReleaseCandidate(project);
    if(!candidate)throw new Error("HTTP Release 找不到 exact Candidate");
    return releaseHttpTarget({
      projectId:project.id,
      connectionId:project.targetConnection.connectionId,
      candidate,
      action:args.action,
    });
  }
  if(!args.deploymentId)throw new Error("Vercel Release 缺少 deploymentId");
  return executeVercelReleaseAction({
    ...args,
    deploymentId:args.deploymentId,
    expectedGitCommitSha:project.release.sourceGitCommitSha,
  });
}

export async function runServerMissionRelease(project:EvolveProject){
  let httpReceipt:ReleaseAdapterResult|undefined;
  const outcome=await runServerReleaseOrchestration(project,{
    authorize:async({candidateId})=>{
      const grant=await getActiveReleaseApprovalGrant({missionId:project.id,candidateId});
      return grant
        ?{ok:true}
        :{ok:false,reason:"当前 Candidate 没有未过期且未撤销的 durable Release Approval grant。"};
    },
    execute:async(args)=>{
      const receipt=await executeServerReleaseProvider(project,args);
      if(projectUsesHttpRelease(project))httpReceipt=receipt;
      return receipt;
    },
  });
  if(httpReceipt?.observedAt&&outcome.project.release.observedAt===httpReceipt.observedAt){
    const recorded=await recordHttpReleaseOutcomeObservation(outcome.project,httpReceipt).catch(()=>undefined);
    if(recorded?.telemetry?.warnings.length){
      console.warn("[outcome-telemetry] HTTP release receipt completed with warnings",recorded.telemetry.warnings);
    }
  }
  return outcome;
}
