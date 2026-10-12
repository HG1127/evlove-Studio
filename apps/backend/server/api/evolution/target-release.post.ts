import {createError,defineEventHandler,readBody} from "nitro/h3";
import {TargetReleaseProxyRequestSchema} from "@evolution/contracts";
import {currentReleaseCandidate,deliveryReadiness,expectedReleaseArtifactHashes,htmlProtectionAcceptanceBlocker,nextDurableReleaseAction,projectUsesHttpRelease} from "@evolution/core";
import {executeServerReleaseProvider} from "../../../src/services/server-release-orchestration";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireActiveReleaseApprovalGrant} from "../../../src/services/release-approval-store";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

function fail(reason:string):never{throw createError({statusCode:409,statusMessage:reason});}
export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"release.execute");
  const input=TargetReleaseProxyRequestSchema.parse(await readBody(event));
  const mission=await getServerProductionRuntime().missions.get(input.projectId);
  if(!mission)fail("Release Mission not found; stored acceptance authority is required");
  const rollback=input.action==="rollback";
  if(!rollback){const blocker=htmlProtectionAcceptanceBlocker(mission);if(blocker)fail(blocker);}
  if(!projectUsesHttpRelease(mission)||!mission.releaseTarget?.connectionId)fail("Stored Mission is not connected to an HTTP Release Target");
  if(input.connectionId!==mission.releaseTarget.connectionId)fail("Release connection does not match the stored target");
  const candidate=rollback
    ?mission.candidates.find(item=>item.id===mission.release.candidateId)
      ??(mission.searchChampion?.candidate?.id===mission.release.candidateId?mission.searchChampion.candidate:undefined)
    :currentReleaseCandidate(mission);
  if(!candidate||candidate.id!==input.candidate.id)fail("Release Candidate does not match the stored release subject");
  if(rollback){
    if(mission.release.status==="idle"||!mission.release.stableDeploymentId)fail("Rollback requires a stored deployed subject and stable recovery binding");
  }else{
    const readiness=deliveryReadiness(mission);if(!readiness.ready)fail(readiness.reasons.join("；"));
    if(mission.gates.find(gate=>gate.id==="artifact-ready")?.status!=="approved")fail("Artifact Ready gate is not approved");
    if(mission.gates.find(gate=>gate.id==="release-ready")?.status!=="approved")fail("Release Ready gate is not approved");
    if(nextDurableReleaseAction(mission)!==input.action)fail("Release action does not match the stored release stage");
    try{await requireActiveReleaseApprovalGrant({missionId:mission.id,candidateId:candidate.id});}
    catch(error){fail(error instanceof Error?error.message:"Release approval is required");}
  }
  try{
    // Drop client Candidate content and frozen payloads. The existing provider
    // prepares exact Gate F receipts from physical stored blobs and verifies SHA.
    return await executeServerReleaseProvider(mission,{
      action:input.action,artifactHashes:rollback?[]:expectedReleaseArtifactHashes(candidate),
      deploymentId:rollback?mission.release.stableDeploymentId:mission.release.deploymentId,
      stableDeploymentId:mission.release.stableDeploymentId,healthPath:mission.releaseTarget.healthPath,
    });
  }catch(error){
    if((error as {code?:string}).code==="TARGET_PROXY_NOT_CONFIGURED")throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
    fail(error instanceof Error?error.message:"Stored Release evidence could not be prepared");
  }
});
