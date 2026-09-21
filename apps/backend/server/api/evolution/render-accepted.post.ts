import {createError,defineEventHandler,readBody} from "nitro/h3";
import {
  AcceptedArtifactRenderRequestSchema,
  AcceptedArtifactRenderResponseSchema,
  createEvolutionEvent,
} from "@evolution/contracts";
import {materializeAcceptedChampionPackage} from "@evolution/core";
import {renderAcceptedProjectArtifacts} from "../../../src/services/server-artifact-renderer";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"target.write");
  const input=AcceptedArtifactRenderRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  const champion=mission.searchChampion;
  if(!champion?.candidate)throw createError({statusCode:409,statusMessage:"Mission has no Search Champion"});
  const artifacts=materializeAcceptedChampionPackage(mission);
  const rendered=await renderAcceptedProjectArtifacts(mission,artifacts);
  const updated={
    ...mission,
    outputArtifacts:rendered.outputArtifacts,
    artifactAcceptance:champion.artifactAcceptance!,
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
      candidateId:champion.candidate.id,
      renderedCount:rendered.receipts.length,
      artifactRefs:rendered.receipts.map((item)=>item.artifactRef),
      artifactHashes:rendered.receipts.map((item)=>item.sha256),
    },
  }));
  return AcceptedArtifactRenderResponseSchema.parse({
    missionId:mission.id,
    candidateId:champion.candidate.id,
    renderedCount:rendered.receipts.length,
    receipts:rendered.receipts,
    observedAt:new Date().toISOString(),
    note:"Rendered and structurally verified Gate F accepted artifacts into Server Artifact Store.",
  });
});
