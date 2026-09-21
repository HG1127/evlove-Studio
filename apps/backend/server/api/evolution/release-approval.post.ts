import {createError,defineEventHandler,readBody} from "nitro/h3";
import {
  createEvolutionEvent,
  ReleaseApprovalRequestSchema,
  ReleaseApprovalResponseSchema,
} from "@evolution/contracts";
import {beginReleaseCycle,deliveryReadiness,projectHasOnlineReleaseTarget} from "@evolution/core";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=requireEvolutionPermission(event,"release.approve");
  const input=ReleaseApprovalRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  const readiness=deliveryReadiness(mission);
  if(!readiness.ready)throw createError({statusCode:409,statusMessage:readiness.reasons.join("；")||"Delivery readiness not satisfied"});
  const candidateId=mission.experimentRun.winnerId??mission.searchChampion?.candidate?.id;
  if(projectHasOnlineReleaseTarget(mission)&&!candidateId){
    throw createError({statusCode:409,statusMessage:"没有 exact Release Candidate，不能授权上线"});
  }
  const approvedAt=new Date().toISOString();
  const release=projectHasOnlineReleaseTarget(mission)&&candidateId
    &&(mission.release.candidateId!==candidateId||mission.release.status!=="idle")
      ?beginReleaseCycle(mission.release,candidateId)
      :mission.release;
  const updated={
    ...mission,
    release,
    gates:mission.gates.map((gate)=>gate.id==="release-ready"
      ?{...gate,status:"approved" as const,approvedAt,note:input.note??"Release Ready approved by authorized actor"}
      :gate),
    updatedAt:approvedAt,
  };
  await runtime.missions.save(updated);
  await runtime.events.append(createEvolutionEvent({
    missionId:mission.id,type:"ActionCompleted",source:"release-approval",
    payload:{action:"approve-release-ready",actorId:actor.id,role:actor.role,candidateId,approvedAt,note:input.note},
  }));
  return ReleaseApprovalResponseSchema.parse({missionId:mission.id,status:"approved",approvedAt,candidateId,actorId:actor.id});
});
