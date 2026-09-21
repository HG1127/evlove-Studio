import { createError, defineEventHandler, readBody } from "nitro/h3";
import { SandboxTargetBatchRequestSchema, SandboxTargetBatchResponseSchema } from "@evolution/contracts";
import { runVercelSandboxCodebaseValidation } from "@evolution/adapters/sandbox";
import { getServerArtifactStore } from "../../../src/services/artifact-runtime";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"target.execute");
  const input=SandboxTargetBatchRequestSchema.parse(await readBody(event));
  const mission=await getServerProductionRuntime().missions.get(input.projectId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});

  const source=mission.sourceArtifacts.find((artifact)=>artifact.id===input.sourceArtifactId&&artifact.role==="target");
  if(!source)throw createError({statusCode:400,statusMessage:"Target Source Artifact not found in Mission"});

  if(input.candidateId){
    if(!input.artifactSha256){
      throw createError({statusCode:400,statusMessage:"Candidate Sandbox execution requires frozen Artifact SHA-256"});
    }
    const candidate=mission.candidates.find((item)=>item.id===input.candidateId)
      ?? (mission.searchChampion?.candidate?.id===input.candidateId?mission.searchChampion.candidate:undefined);
    const snapshot=candidate?.artifactSnapshots.find((item)=>item.sourceArtifactId===source.id);
    // Mission projection is eventually consistent with browser execution. If the Candidate has already
    // arrived, enforce the exact receipt. If it has not arrived yet, the downloaded blob is still bound
    // by the caller's frozen SHA-256 and re-hashed inside the Sandbox adapter before execution.
    if(snapshot?.frozenArtifact){
      if(snapshot.frozenArtifact.blobId!==input.artifactBlobId){
        throw createError({statusCode:409,statusMessage:"Candidate frozen Artifact binding mismatch"});
      }
      if(snapshot.frozenArtifact.sha256.toLowerCase()!==input.artifactSha256.toLowerCase()){
        throw createError({statusCode:409,statusMessage:"Candidate Artifact SHA-256 binding mismatch"});
      }
    }
  }else if(input.artifactBlobId!==source.id){
    throw createError({statusCode:409,statusMessage:"Baseline Artifact binding mismatch"});
  }

  const blob=await getServerArtifactStore().get(input.artifactBlobId);
  if(!blob)throw createError({statusCode:404,statusMessage:"Artifact blob not found"});

  const result=await runVercelSandboxCodebaseValidation({
    id:`${input.projectId}-${input.candidateId??"baseline"}`,
    archive:new Uint8Array(await blob.arrayBuffer()),
    expectedSha256:input.artifactSha256,
    testCases:input.testCases,
  });
  return SandboxTargetBatchResponseSchema.parse(result);
});
