import {getServerProductionRuntime} from "./production-runtime";
import {htmlProtectionCanonicalJson as canonical} from "./server-html-protection-authority-attestation";
import {restoreServerHtmlProtectionAcceptedProject,serverHtmlProtectionAcceptedContext} from "./server-html-protection-accepted-authority";
import type {ReleaseApprovalGrant,ArtifactStorePort,EvolveProject,ReleaseAdapterResult,ReleaseOutcomeTelemetryStatus} from "@evolution/contracts";
import {hasHtmlProtectionTarget,isWholeProtectionCriterion,expectedReleaseArtifactHashes,nextDurableReleaseAction,deliveryReadiness,htmlProtectionAcceptanceBlocker,currentReleaseCandidate,projectUsesConnectorRelease,projectUsesHttpRelease} from "@evolution/core";
import {runServerReleaseOrchestration,type ServerReleasePorts} from "@evolution/harness";
import {executeConnectorReleaseAction} from "./connector-release";
import {releaseHttpTarget} from "./http-target-gateway";
import {prepareServerHttpReleaseArtifacts} from "./server-http-release-artifacts";
import {getActiveReleaseApprovalGrant,requireActiveReleaseApprovalGrant} from "./release-approval-store";
import {recordConnectorReleaseOutcomeObservation,recordHttpReleaseOutcomeObservation} from "./release-outcome-telemetry";
import {captureReleaseOutcomeTelemetry} from "./release-outcome-status";
import {executeVercelReleaseAction} from "./vercel-release";

export async function executeServerReleaseProvider(
  project:EvolveProject,
  args:Parameters<ServerReleasePorts["execute"]>[0],
  artifactStore?:Pick<ArtifactStorePort,"get">,
  expectedApprovalGrant?:ReleaseApprovalGrant,
){
  const ingressArgs=canonical(args),runtime=getServerProductionRuntime();
  let restored:Awaited<ReturnType<typeof restoreServerHtmlProtectionAcceptedProject>>|undefined,initialGrant:ReleaseApprovalGrant|undefined;
  const rollbackSubject=()=>{const champion=project.searchChampion?.candidate;return project.candidates.find(item=>item.id===project.release.candidateId)??(champion?.id===project.release.candidateId?champion:undefined);};
  const rollbackBinding=canonical({missionId:project.id,release:project.release,target:project.releaseTarget,targetConnection:project.targetConnection,candidate:rollbackSubject()});
  if(args.action!=="rollback"){
    const candidate=currentReleaseCandidate(project);if(!candidate)throw Error("Exact accepted release Candidate is missing");
    restored=await restoreServerHtmlProtectionAcceptedProject({project,candidateId:candidate.id});project=restored.project;
    initialGrant=await requireActiveReleaseApprovalGrant({missionId:project.id,candidateId:candidate.id});
    if(expectedApprovalGrant&&canonical(initialGrant)!==canonical(expectedApprovalGrant))throw Error("Initial durable Release Approval identity changed");
  }
  const assertBeforeProvider=async()=>{
    if(canonical(args)!==ingressArgs)throw Error("Release request changed during file preparation");
    if(args.action==="rollback"){
      // Recovery consumes the existing deployed/stable binding, never fresh measurement, grant or Candidate file claims.
      const stored=await runtime.missions.get(project.id);if(!stored)throw Error("Rollback stored subject disappeared");
      const champion=stored.searchChampion?.candidate;
      const subject=stored.candidates.find(item=>item.id===stored.release.candidateId)??(champion?.id===stored.release.candidateId?champion:undefined);
      if(canonical({missionId:stored.id,release:stored.release,target:stored.releaseTarget,targetConnection:stored.targetConnection,candidate:subject})!==rollbackBinding)throw Error("Rollback stored stable binding changed");
      return ()=>{if(canonical(args)!==ingressArgs||canonical({missionId:project.id,release:project.release,target:project.releaseTarget,targetConnection:project.targetConnection,candidate:rollbackSubject()})!==rollbackBinding)throw Error("Rollback request or local stable binding changed before dispatch");};
    }
    if(!restored||!initialGrant)throw Error("Accepted release authority was not independently restored");
    const candidate=currentReleaseCandidate(project);if(!candidate)throw Error("Accepted release Candidate disappeared");
    const sameGrant=(grant:ReleaseApprovalGrant)=>{const now=Date.now();if(canonical(grant)!==canonical(initialGrant)||grant.missionId!==project.id||grant.candidateId!==candidate.id||!["approver","admin"].includes(grant.approvedRole)||grant.revokedAt||!Number.isFinite(Date.parse(grant.approvedAt))||Date.parse(grant.approvedAt)>now
      ||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=now)throw Error("Durable Release Approval changed or expired during preparation");};
    sameGrant(await requireActiveReleaseApprovalGrant({missionId:project.id,candidateId:candidate.id}));
    // Includes all original physical metadata, actors/SDK/selected route, acceptance/Gate F/papers/connection/stage and original authority expiry.
    await restored.assertStable();
    const actual=await runtime.missions.get(project.id);if(!actual||serverHtmlProtectionAcceptedContext(actual)!==serverHtmlProtectionAcceptedContext(project))throw Error("Release Mission changed after final acceptance restoration");
    const finalGrant=await requireActiveReleaseApprovalGrant({missionId:project.id,candidateId:candidate.id});sameGrant(finalGrant);
    // Check owner/SDK/sealed model selection again AFTER the last grant I/O. This is an observed-state guard, not distributed atomicity.
    await restored.assertStable();
    if(canonical(args.artifactHashes)!==canonical(expectedReleaseArtifactHashes(candidate)))throw Error("Release Artifact Hash identity changed during preparation");
    const readiness=deliveryReadiness(project);if(!readiness.ready)throw Error(readiness.reasons.join("；"));
    if(canonical(args)!==ingressArgs)throw Error("Release request changed during final approval read");
    const criterionIds=new Set(hasHtmlProtectionTarget(project)!==false?project.acceptanceRubric.filter(isWholeProtectionCriterion).map(item=>item.id):[]),refs=[...project.validationRun.baselineRuns,...project.validationRun.runs].flatMap(run=>run.htmlProtectionAuthorityRefs??[]).filter(ref=>criterionIds.has(ref.criterionId));
    if(criterionIds.size&&!refs.length)throw Error("Original whole authority deadline is unavailable");
    const authorityDeadline=refs.length?Math.min(...refs.map(ref=>Date.parse(ref.expiresAt))):Infinity,
      observedNotBefore=Math.max(Date.parse(initialGrant.approvedAt),...refs.map(ref=>Date.parse(ref.observedAt))),deadline=Math.min(Date.parse(initialGrant.expiresAt),authorityDeadline);
    const checkDispatch=()=>{
      if(canonical(args)!==ingressArgs||canonical(args.artifactHashes)!==canonical(expectedReleaseArtifactHashes(candidate)))throw Error("Release dispatch identity changed");
      const currentReadiness=deliveryReadiness(project);if(!currentReadiness.ready)throw Error(currentReadiness.reasons.join("；"));
      sameGrant(finalGrant);
      // Clock is sampled AFTER all synchronous identity/readiness/grant calculations. Original deadlines are never renewed.
      const now=Date.now();if(!Number.isFinite(deadline)||!Number.isFinite(observedNotBefore)||now<observedNotBefore||now>=deadline)throw Error("Original release approval or authority expired before dispatch");
    };
    checkDispatch();return checkDispatch;
  };
  const contractBlocker=args.action!=="rollback" && htmlProtectionAcceptanceBlocker(project);
  if(contractBlocker)throw new Error(contractBlocker);
  if(projectUsesConnectorRelease(project)){
    await assertBeforeProvider();
    return executeConnectorReleaseAction(project,{
      action:args.action,
      deploymentId:args.deploymentId,
      stableDeploymentId:args.stableDeploymentId,
      artifactHashes:args.artifactHashes,
    },undefined,undefined,assertBeforeProvider);
  }
  if(projectUsesHttpRelease(project)){
    const candidate=args.action==="rollback"&&project.release.candidateId
      ?project.candidates.find(item=>item.id===project.release.candidateId)
        ??(project.searchChampion?.candidate?.id===project.release.candidateId?project.searchChampion.candidate:undefined)
      :currentReleaseCandidate(project);
    if(!candidate)throw new Error("HTTP Release 找不到 exact Candidate");
    const connectionId=project.releaseTarget?.connectionId;
    if(!connectionId)throw new Error("HTTP Release 缺少独立 releaseTarget.connectionId");
    const prepared=args.action==="rollback"
      ?{candidate,frozenArtifacts:undefined}
      :await prepareServerHttpReleaseArtifacts(project,candidate,artifactStore);
    await assertBeforeProvider();
    return releaseHttpTarget({
      projectId:project.id,
      connectionId,
      candidate:prepared.candidate,
      frozenArtifacts:prepared.frozenArtifacts,
      action:args.action,
    },assertBeforeProvider);
  }
  if(!args.deploymentId)throw new Error("Vercel Release 缺少 deploymentId");
  await assertBeforeProvider();
  return executeVercelReleaseAction({
    ...args,
    deploymentId:args.deploymentId,
    expectedGitCommitSha:project.release.sourceGitCommitSha,
  },assertBeforeProvider);
}

export async function runServerMissionRelease(project:EvolveProject,artifactStore?:Pick<ArtifactStorePort,"get">){
  const candidate=currentReleaseCandidate(project);if(candidate&&nextDurableReleaseAction(project)!=="rollback")project=(await restoreServerHtmlProtectionAcceptedProject({project,candidateId:candidate.id})).project;
  let boundApprovalGrant:ReleaseApprovalGrant|undefined;
  let adapterReceipt:ReleaseAdapterResult|undefined;
  const outcome=await runServerReleaseOrchestration(project,{
    authorize:async({candidateId})=>{
      const grant=await getActiveReleaseApprovalGrant({missionId:project.id,candidateId});
      boundApprovalGrant=grant;
      return grant
        ?{ok:true}
        :{ok:false,reason:"当前 Candidate 没有未过期且未撤销的 durable Release Approval grant。"};
    },
    execute:async(args)=>{
      const receipt=await executeServerReleaseProvider(project,args,artifactStore,boundApprovalGrant);
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
