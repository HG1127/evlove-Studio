import { createError, defineEventHandler, readBody } from "nitro/h3";
import {
  createEvolutionEvent,
  VercelReleaseReconcileRequestSchema,
  VercelReleaseReconcileResponseSchema,
} from "@evolution/contracts";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
import { runServerMissionReleaseReconciliation } from "../../../src/services/server-release-reconciliation";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"release.execute");
  const input=VercelReleaseReconcileRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  if(mission.releaseTarget?.provider!=="vercel"){
    throw createError({statusCode:409,statusMessage:"Mission 未连接 Vercel Release Target"});
  }
  const outcome=await runServerMissionReleaseReconciliation(mission);
  await runtime.missions.save(outcome.project);
  await runtime.events.append(createEvolutionEvent({
    missionId:mission.id,
    type:"ReleaseChanged",
    source:"manual-release-reconcile",
    payload:{
      disposition:outcome.disposition,
      candidateId:outcome.project.release.candidateId,
      deploymentId:outcome.project.release.deploymentId,
      stableDeploymentId:outcome.project.release.stableDeploymentId,
      artifactHashes:outcome.project.release.artifactHashes,
      evidenceMode:outcome.project.release.evidenceMode,
      observedAt:outcome.project.release.observedAt,
      recovery:outcome.project.release.recovery,
      productionDeploymentId:outcome.observation.productionDeployment?.id,
      boundDeploymentId:outcome.observation.boundDeployment?.id,
      productionHealthReady:outcome.observation.productionHealth.ready,
      boundHealthReady:outcome.observation.boundHealth?.ready,
      checkedAt:outcome.observation.checkedAt,
      observationErrors:outcome.observation.errors,
      reason:outcome.reason,
    },
  }));
  return VercelReleaseReconcileResponseSchema.parse({
    disposition:outcome.disposition,
    reason:outcome.reason,
    observation:outcome.observation,
    releaseStatus:outcome.project.release.status,
    recoveryStatus:outcome.project.release.recovery?.status,
  });
});
