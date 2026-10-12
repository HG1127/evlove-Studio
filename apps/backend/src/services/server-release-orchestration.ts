import type {ArtifactStorePort,EvolveProject,ReleaseAdapterResult,ReleaseOutcomeTelemetryStatus} from "@evolution/contracts";
import {htmlProtectionContractBlocker,currentReleaseCandidate,projectUsesConnectorRelease,projectUsesHttpRelease} from "@evolution/core";
import {runServerReleaseOrchestration,type ServerReleasePorts} from "@evolution/harness";
import {executeConnectorReleaseAction} from "./connector-release";
import {releaseHttpTarget} from "./http-target-gateway";
import {prepareServerHttpReleaseArtifacts} from "./server-http-release-artifacts";
import {getActiveReleaseApprovalGrant} from "./release-approval-store";
import {recordConnectorReleaseOutcomeObservation,recordHttpReleaseOutcomeObservation} from "./release-outcome-telemetry";
import {captureReleaseOutcomeTelemetry} from "./release-outcome-status";
import {executeVercelReleaseAction} from "./vercel-release";

export async function executeServerReleaseProvider(
  project:EvolveProject,
  args:Parameters<ServerReleasePorts["execute"]>[0],
  artifactStore?:Pick<ArtifactStorePort,"get">,
){
  const contractBlocker=args.action!=="rollback" && htmlProtectionContractBlocker(project);
  if(contractBlocker)throw new Error(contractBlocker);
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
    const connectionId=project.releaseTarget?.connectionId;
    if(!connectionId)throw new Error("HTTP Release 缺少独立 releaseTarget.connectionId");
    const prepared=args.action==="rollback"
      ?{candidate,frozenArtifacts:undefined}
      :await prepareServerHttpReleaseArtifacts(project,candidate,artifactStore);
    return releaseHttpTarget({
      projectId:project.id,
      connectionId,
      candidate:prepared.candidate,
      frozenArtifacts:prepared.frozenArtifacts,
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

export async function runServerMissionRelease(project:EvolveProject,artifactStore?:Pick<ArtifactStorePort,"get">){
  let adapterReceipt:ReleaseAdapterResult|undefined;
  const outcome=await runServerReleaseOrchestration(project,{
    authorize:async({candidateId})=>{
      const grant=await getActiveReleaseApprovalGrant({missionId:project.id,candidateId});
      return grant
        ?{ok:true}
        :{ok:false,reason:"当前 Candidate 没有未过期且未撤销的 durable Release Approval grant。"};
    },
    execute:async(args)=>{
      const receipt=await executeServerReleaseProvider(project,args,artifactStore);
      if(projectUsesHttpRelease(project)||projectUsesConnectorRelease(project))adapterReceipt=receipt;
      return receipt;
    },
  });
  let outcomeTelemetry:ReleaseOutcomeTelemetryStatus|undefined;
  if(adapterReceipt?.observedAt&&outcome.project.release.observedAt===adapterReceipt.observedAt){
    const acceptedReceipt=adapterReceipt;
    outcomeTelemetry=await captureReleaseOutcomeTelemetry(()=>(projectUsesConnectorRelease(project)
      ?recordConnectorReleaseOutcomeObservation(outcome.project,acceptedReceipt)
      :recordHttpReleaseOutcomeObservation(outcome.project,acceptedReceipt)));
  }
  return {...outcome,outcomeTelemetry};
}
