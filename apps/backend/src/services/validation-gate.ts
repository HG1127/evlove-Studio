import {createHash} from "node:crypto";
import {createEvolutionEvent,type EvolutionEvent,type ProductionRuntimePorts} from "@evolution/contracts";
import {appendEvidenceLedger,canonicalEvidenceJson,EventEvidenceIdentityConflictError,mirrorEvolutionEventToEvidenceLedger} from "./evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";
import {registerArtifactEvidence} from "./evidence-runtime";
import {getServerEventById,getServerValidationRecord} from "./production-runtime";

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

export class CheckpointArtifactDriftError extends Error{
  constructor(){super("Checkpoint Artifact bytes or durable metadata differ from the passed Validation");this.name="CheckpointArtifactDriftError";}
}

export class CheckpointValidationEvidenceError extends Error{
  constructor(){super("Checkpoint Validation Event is missing or bound to different evidence");this.name="CheckpointValidationEvidenceError";}
}

async function readSourceValidationRecord(input:{missionId:string;checkpointId:string;artifactId:string;artifactSha256:string;validationId:string;status:string}){
  const record=await getServerValidationRecord(input.validationId);
  const result=record?.result;
  if(!record||!result||result.missionId!==input.missionId||result.checkpointId!==input.checkpointId
    ||result.artifactId!==input.artifactId||result.artifactSha256!==(input.artifactSha256||undefined)
    ||result.status!==input.status){
    throw new CheckpointValidationEvidenceError();
  }
  return record;
}

async function completeSourceValidationEvidence(record:NonNullable<Awaited<ReturnType<typeof getServerValidationRecord>>>){
  const result=record.result;
  try{await mirrorEvolutionEventToEvidenceLedger(record.event);}
  catch(error){
    if(error instanceof EventEvidenceIdentityConflictError)throw error;
    throw new EventEvidenceMirrorError(record.event.id,error);
  }
  await registerArtifactEvidence({
    missionId:result.missionId,artifactId:result.artifactId,jobId:result.jobId,
    checkpointId:result.checkpointId,kind:"validation",
    payload:{validationId:result.id,status:result.status,artifactSha256:result.artifactSha256},
  });
}

async function assertAcceptedArtifactIdentity(runtime:ProductionRuntimePorts,input:{missionId:string;artifactId:string;artifactSha256:string;jobId?:string}){
  const [artifact,metadata]=await Promise.all([
    runtime.artifacts.get(input.artifactId),runtime.artifacts.getMetadata?.(input.artifactId),
  ]);
  if(!artifact||!metadata||metadata.id!==input.artifactId||metadata.missionId!==input.missionId
    ||(input.jobId!==undefined&&metadata.jobId!==input.jobId)
    ||metadata.sha256!==input.artifactSha256||metadata.sizeBytes!==artifact.size){
    throw new CheckpointArtifactDriftError();
  }
  const actualHash=createHash("sha256").update(new Uint8Array(await artifact.arrayBuffer())).digest("hex");
  if(actualHash!==input.artifactSha256)throw new CheckpointArtifactDriftError();
}

function sameCheckpointValidationEvent(a:EvolutionEvent,b:EvolutionEvent){
  return canonicalEvidenceJson({...a,at:undefined})===canonicalEvidenceJson({...b,at:undefined});
}

async function appendCheckpointValidationEvent(runtime:ProductionRuntimePorts,event:EvolutionEvent){
  try{await runtime.events.append(event);}
  catch(error){
    if(!(error instanceof EventIdempotencyConflictError))throw error;
    const persisted=await getServerEventById(event.id);
    if(!persisted||!sameCheckpointValidationEvent(event,persisted))throw error;
    try{await mirrorEvolutionEventToEvidenceLedger(persisted);}
    catch(mirrorError){
      if(mirrorError instanceof EventEvidenceIdentityConflictError)throw mirrorError;
      throw new EventEvidenceMirrorError(persisted.id,mirrorError);
    }
  }
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

  const sourceValidation=await readSourceValidationRecord(input);
  if(accepted)await assertAcceptedArtifactIdentity(runtime,{...input,jobId:sourceValidation.result.jobId});
  await completeSourceValidationEvidence(sourceValidation);

  await appendCheckpointValidationEvent(runtime,createEvolutionEvent({
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
