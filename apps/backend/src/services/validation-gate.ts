import {createEvolutionEvent,type ProductionRuntimePorts} from "@evolution/contracts";
import {appendEvidenceLedger} from "./evidence-ledger";

export type ValidationGateResult={
  checkpointId:string;
  missionId:string;
  accepted:boolean;
  validationId:string;
  reason:string;
};

export class CheckpointBindingError extends Error{
  constructor(){super("Checkpoint does not match the current persisted Mission checkpoint");this.name="CheckpointBindingError";}
}

export async function evaluateCheckpointValidation(
  runtime:ProductionRuntimePorts,
  input:{checkpointId:string;missionId:string;artifactId:string;artifactSha256:string;validationId:string;status:"passed"|"failed"|"partial"|"pending"},
):Promise<ValidationGateResult>{
  const mission=await runtime.missions.get(input.missionId);
  if(!mission||mission.campaign.checkpoint?.id!==input.checkpointId){
    throw new CheckpointBindingError();
  }
  const accepted=input.status==="passed"&&Boolean(input.artifactSha256);
  const reason=accepted?"validation passed":"validation not accepted";

  await runtime.events.append(createEvolutionEvent({
    id:`checkpoint-validation:${input.validationId}`,
    missionId:input.missionId,
    checkpointId:input.checkpointId,
    type:accepted?"CheckpointAccepted":"CheckpointRejected",
    source:"backend-validation-gate",
    payload:{artifactId:input.artifactId,artifactSha256:input.artifactSha256,validationId:input.validationId,status:input.status},
  }));

  await appendEvidenceLedger({
    id:"checkpoint-validation-"+input.validationId,
    missionId:input.missionId,
    kind:"checkpoint-validation",
    source:"backend-validation-gate",
    actor:"system",
    decision:accepted?"accepted":"rejected",
    payload:input,
    artifactRefs:[input.artifactId],
  });

  return {
    checkpointId:input.checkpointId,
    missionId:input.missionId,
    accepted,
    validationId:input.validationId,
    reason,
  };
}
