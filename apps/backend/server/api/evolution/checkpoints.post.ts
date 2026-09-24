import {defineEventHandler,readBody,createError} from "nitro/h3";
import {compareAndSwapServerMissionEnvelopeWithEvent,getServerMissionEnvelope,MissionRevisionConflictError} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {CampaignCheckpointSchema,CheckpointCreateRequestSchema,createEvolutionEvent} from "@evolution/contracts";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.write");
  const parsed=CheckpointCreateRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:parsed.error.message});
  const input=parsed.data;
  const envelope=await getServerMissionEnvelope(input.missionId);
  if(!envelope)throw createError({statusCode:404,statusMessage:"Mission not found"});
  const prior=envelope.payload.campaign.checkpoint;
  if(prior?.id&&prior.round===input.round&&prior.completedPhase===input.completedPhase){
    return {missionId:input.missionId,checkpointId:prior.id,checkpoint:prior};
  }
  const now=new Date().toISOString();
  const checkpointId=`checkpoint:${input.missionId}:${envelope.revision}:${input.round}:${input.completedPhase}`;
  const checkpoint=CampaignCheckpointSchema.parse({
    id:checkpointId,round:input.round,completedPhase:input.completedPhase,at:now,
  });
  const next={
    ...envelope,updatedAt:now,
    payload:{...envelope.payload,campaign:{...envelope.payload.campaign,checkpoint},updatedAt:now},
  };
  const change=createEvolutionEvent({
    id:checkpointId,missionId:input.missionId,checkpointId,type:"CheckpointCreated",
    source:"backend-checkpoint",payload:{round:input.round,completedPhase:input.completedPhase},at:now,
  });
  try{
    const saved=await compareAndSwapServerMissionEnvelopeWithEvent(next,change);
    return {missionId:saved.missionId,checkpointId,checkpoint:saved.payload.campaign.checkpoint};
  }catch(error){
    if(error instanceof MissionRevisionConflictError)throw createError({statusCode:409,statusMessage:error.message});
    throw error;
  }
});
