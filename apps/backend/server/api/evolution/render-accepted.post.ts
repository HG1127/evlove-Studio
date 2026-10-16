import {restoreServerHtmlProtectionAcceptedProject} from "../../../src/services/server-html-protection-accepted-authority";
import {createError,defineEventHandler,readBody} from "nitro/h3";
import {
  AcceptedArtifactRenderRequestSchema,
  AcceptedArtifactRenderResponseSchema,
  createEvolutionEvent,
} from "@evolution/contracts";
import {materializeAcceptedCandidatePackage,materializeAcceptedChampionPackage} from "@evolution/core";
import {renderAcceptedProjectArtifacts} from "../../../src/services/server-artifact-renderer";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"target.write");
  const parsed=AcceptedArtifactRenderRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"Invalid accepted Artifact render request"});
  const input=parsed.data;
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  const champion=mission.searchChampion;
  const candidateId=input.candidateId??champion?.candidate?.id;
  const candidate=candidateId===champion?.candidate?.id?champion?.candidate:mission.candidates.find((item)=>item.id===candidateId);
  if(!candidate)throw createError({statusCode:409,statusMessage:"Requested accepted Candidate not found"});
  const restored=await restoreServerHtmlProtectionAcceptedProject({project:mission,candidateId:candidate.id});
  let artifacts;
  try{
    artifacts=candidate.id===champion?.candidate?.id
      ?materializeAcceptedChampionPackage(restored.project)
      :materializeAcceptedCandidatePackage(restored.project,restored.candidate,restored.project.artifactAcceptance);
  }catch(error){
    throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:"Candidate is not deliverable"});
  }
  const rendered=await renderAcceptedProjectArtifacts(restored.project,artifacts);
  const updated={
    ...mission,
    outputArtifacts:rendered.outputArtifacts,
    stage:"learning" as const,
    updatedAt:new Date().toISOString(),
  };
  await runtime.missions.save(updated);
  await runtime.events.append(createEvolutionEvent({
    missionId:mission.id,
    type:"ActionCompleted",
    source:"server-artifact-renderer",
    payload:{
      action:"render-accepted",
      candidateId:candidate.id,
      renderedCount:rendered.receipts.length,
      artifactRefs:rendered.receipts.map((item)=>item.artifactRef),
      artifactHashes:rendered.receipts.map((item)=>item.sha256),
    },
  }));
  return AcceptedArtifactRenderResponseSchema.parse({
    missionId:mission.id,
    candidateId:candidate.id,
    renderedCount:rendered.receipts.length,
    receipts:rendered.receipts,
    observedAt:new Date().toISOString(),
    note:"Bound the exact Gate F frozen Artifact blobs after size and SHA-256 readback; no post-acceptance bytes were regenerated.",
  });
});
