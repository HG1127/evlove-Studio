import {createError,defineEventHandler,readBody} from "nitro/h3";
import {
  createEvolutionEvent,
  ReleaseApprovalRevokeRequestSchema,
  ReleaseApprovalRevokeResponseSchema,
} from "@evolution/contracts";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {revokeReleaseApprovalGrants} from "../../../src/services/release-approval-store";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const actor=requireEvolutionPermission(event,"release.approve");
  const input=ReleaseApprovalRevokeRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  let revoked;
  try{
    revoked=await revokeReleaseApprovalGrants({missionId:mission.id});
  }catch(error){
    throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
  }
  const updated={
    ...mission,
    gates:mission.gates.map((gate)=>gate.id==="release-ready"
      ?{...gate,status:"ready" as const,approvedAt:undefined,note:input.note??"Release Ready authorization revoked"}
      :gate),
    updatedAt:revoked.revokedAt,
  };
  await runtime.missions.save(updated);
  await runtime.events.append(createEvolutionEvent({
    missionId:mission.id,
    type:"ActionCompleted",
    source:"release-approval-revoke",
    payload:{action:"revoke-release-ready",actorId:actor.id,role:actor.role,revokedAt:revoked.revokedAt,revokedCount:revoked.revokedCount,note:input.note},
  }));
  return ReleaseApprovalRevokeResponseSchema.parse({
    missionId:mission.id,status:"revoked",revokedAt:revoked.revokedAt,revokedCount:revoked.revokedCount,actorId:actor.id,
  });
});
