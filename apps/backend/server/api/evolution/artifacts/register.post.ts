import {createError,defineEventHandler,readBody} from "nitro/h3";
import {ArtifactRegistrationRequestSchema} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";
import {linkArtifactEvidence,registerArtifact} from "../../../../src/services/artifact-lifecycle";
import {requireGovernedEvolutionPermission} from "../../../../src/services/security-policy";
import {assertServerArtifactEvidenceReady} from "../../../../src/services/artifact-evidence-readiness";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");

  const parsed=ArtifactRegistrationRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid Artifact registration request",data:parsed.error.flatten()});
  const body=parsed.data;
  const runtime=getServerProductionRuntime();
  if(body.missionId){
    const mission=await runtime.missions.get(body.missionId);
    if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
    if(body.jobId){
      const job=await runtime.jobs.get(body.jobId);
      if(!job||job.missionId!==body.missionId)throw createError({statusCode:409,statusMessage:"Job is missing or belongs to another Mission"});
    }
  }else if(body.jobId){
    throw createError({statusCode:400,statusMessage:"jobId requires missionId"});
  }

  await assertServerArtifactEvidenceReady(body.missionId);
  const artifact=await registerArtifact(body);

  if(artifact.missionId){
    await linkArtifactEvidence(
      runtime,
      {
        missionId:artifact.missionId,
        jobId:artifact.jobId,
        artifactId:artifact.id,
        sha256:artifact.sha256,
        kind:artifact.kind,
      },
    );
  }

  return artifact;
});
