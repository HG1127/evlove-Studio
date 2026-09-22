import type {EvolveProject,ReleaseAdapterResult} from "@evolution/contracts";
import {currentReleaseCandidate,projectUsesConnectorRelease,projectUsesHttpRelease} from "@evolution/core";
import {runServerReleaseOrchestration,type ServerReleasePorts} from "@evolution/harness";
import {executeConnectorReleaseAction} from "./connector-release";
import {releaseHttpTarget} from "./http-target-gateway";
import {getActiveReleaseApprovalGrant} from "./release-approval-store";
import {recordConnectorReleaseOutcomeObservation,recordHttpReleaseOutcomeObservation} from "./release-outcome-telemetry";
import {executeVercelReleaseAction} from "./vercel-release";

export async function executeServerReleaseProvider(
  project:EvolveProject,
  args:Parameters<ServerReleasePorts["execute"]>[0],
){
  if(projectUsesConnectorRelease(project)){
    return executeConnectorReleaseAction(project,{
      action:args.action,
      deploymentId:args.deploymentId,
      stableDeploymentId:args.stableDeploymentId,
      artifactHashes:args.artifactHashes,
    });
  }
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
  let adapterReceipt:ReleaseAdapterResult|undefined;
  const outcome=await runServerReleaseOrchestration(project,{
    authorize:async({candidateId})=>{
      const grant=await getActiveReleaseApprovalGrant({missionId:project.id,candidateId});
      return grant
        ?{ok:true}
        :{ok:false,reason:"当前 Candidate 没有未过期且未撤销的 durable Release Approval grant。"};
    },
    execute:async(args)=>{
      const receipt=await executeServerReleaseProvider(project,args);
      if(projectUsesHttpRelease(project)||projectUsesConnectorRelease(project))adapterReceipt=receipt;
      return receipt;
    },
  });
  if(adapterReceipt?.observedAt&&outcome.project.release.observedAt===adapterReceipt.observedAt){
    const recorded=await (projectUsesConnectorRelease(project)
      ?recordConnectorReleaseOutcomeObservation(outcome.project,adapterReceipt)
      :recordHttpReleaseOutcomeObservation(outcome.project,adapterReceipt)).catch(()=>undefined);
    if(recorded?.telemetry?.warnings.length){
      console.warn("[outcome-telemetry] HTTP release receipt completed with warnings",recorded.telemetry.warnings);
    }
  }
  return outcome;
}
