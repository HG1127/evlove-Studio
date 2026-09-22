import { createError, defineEventHandler, readBody } from "nitro/h3";
import {
  createEvolutionEvent,
  ReleaseReconcileRequestSchema,
  ReleaseReconcileResponseSchema,
} from "@evolution/contracts";
import {projectHasOnlineReleaseTarget} from "@evolution/core";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
import { runServerMissionReleaseReconciliation } from "../../../src/services/server-release-reconciliation";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"release.execute");
  const input=ReleaseReconcileRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  if(!projectHasOnlineReleaseTarget(mission))throw createError({statusCode:409,statusMessage:"Mission 未连接受支持的线上 Release Target"});
  const outcome=await runServerMissionReleaseReconciliation(mission);
  await runtime.missions.save(outcome.project);
  await runtime.events.append(createEvolutionEvent({
    missionId:mission.id,
    type:"ReleaseChanged",
    source:"manual-release-reconcile",
    payload:{
      provider:outcome.provider,
      disposition:outcome.disposition,
      candidateId:outcome.project.release.candidateId,
      deploymentId:outcome.project.release.deploymentId,
      stableDeploymentId:outcome.project.release.stableDeploymentId,
      trafficPercent:outcome.project.release.trafficPercent,
      artifactHashes:outcome.project.release.artifactHashes,
      evidenceMode:outcome.project.release.evidenceMode,
      observedAt:outcome.project.release.observedAt,
      recovery:outcome.project.release.recovery,
      productionDeploymentId:outcome.productionDeploymentId,
      boundDeploymentId:outcome.boundDeploymentId,
      productionHealthReady:outcome.productionHealthReady,
      boundHealthReady:outcome.boundHealthReady,
      rollingRelease:outcome.rollingRelease,
      checkedAt:outcome.observedAt,
      observationErrors:outcome.observationErrors,
      reason:outcome.reason,
    },
  }));
  return ReleaseReconcileResponseSchema.parse({
    provider:outcome.provider,
    disposition:outcome.disposition,
    reason:outcome.reason,
    observedAt:outcome.observedAt,
    observation:outcome.observation,
    releaseStatus:outcome.project.release.status,
    recoveryStatus:outcome.project.release.recovery?.status,
  });
});
