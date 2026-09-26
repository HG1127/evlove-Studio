import {createHash,randomUUID} from "node:crypto";
import {
  createEvolutionEvent,
  ValidationRequestSchema,
  ValidationResultSchema,
  type ValidationResult,
  type ProductionRuntimePorts,
} from "@evolution/contracts";
import {canAcceptValidatedArtifact,evaluateArtifactValidationChecks} from "@evolution/core";
import {EventEvidenceIdentityConflictError,mirrorEvolutionEventToEvidenceLedger} from "./evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";
import {registerArtifactEvidence} from "./evidence-runtime";
import {getServerValidationRecord,getServerValidationResult} from "./production-runtime";

function sha256(bytes:ArrayBuffer){
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

function fingerprint(value:unknown){
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class ValidationIdempotencyConflictError extends Error{
  readonly code="VALIDATION_IDEMPOTENCY_CONFLICT";
  constructor(){super("Validation idempotency key was already used with a different request");this.name="ValidationIdempotencyConflictError";}
}

export class ValidationEvidenceAppendError extends Error{
  constructor(readonly validationId:string,cause:unknown){
    super(`Validation ${validationId} persisted but its Evidence append failed`,{cause});
    this.name="ValidationEvidenceAppendError";
  }
}

export class ValidationPersistenceUncertainError extends Error{
  constructor(readonly validationId:string,cause:unknown){
    super(`Validation ${validationId} Event append outcome is unknown`,{cause});
    this.name="ValidationPersistenceUncertainError";
  }
}

async function jobBelongsToMission(runtime:ProductionRuntimePorts,jobId:string,missionId:string){
  const job=await runtime.jobs.get(jobId);
  return job?.id===jobId&&job.missionId===missionId;
}

async function getMatchingValidation(id:string,requestFingerprint:string,completeMirror:boolean){
  const record=await getServerValidationRecord(id);
  if(!record)return undefined;
  if(record.result.requestFingerprint!==requestFingerprint)throw new ValidationIdempotencyConflictError();
  if(completeMirror){
    try{await mirrorEvolutionEventToEvidenceLedger(record.event);}
    catch(error){
      if(error instanceof EventEvidenceIdentityConflictError)throw error;
      throw new EventEvidenceMirrorError(record.event.id,error);
    }
  }
  return record.result;
}

export async function reconcileValidationEvidence(id:string){
  const record=await getServerValidationRecord(id);
  if(!record)return undefined;
  try{await mirrorEvolutionEventToEvidenceLedger(record.event);}
  catch(error){
    if(error instanceof EventEvidenceIdentityConflictError)throw error;
    throw new EventEvidenceMirrorError(record.event.id,error);
  }
  const validation=record.result;
  let evidence;
  try{
    evidence=await registerArtifactEvidence({
      missionId:validation.missionId,artifactId:validation.artifactId,
      jobId:validation.jobId,checkpointId:validation.checkpointId,kind:"validation",
      payload:{validationId:validation.id,status:validation.status,artifactSha256:validation.artifactSha256},
    });
  }catch(error){throw new ValidationEvidenceAppendError(id,error);}
  return {validation,evidence};
}

export async function validateArtifact(runtime:ProductionRuntimePorts,input:unknown){
  const request=ValidationRequestSchema.parse(input);
  const requestFingerprint=fingerprint({...request,idempotencyKey:undefined});
  const createdAt=new Date().toISOString();
  const id=request.idempotencyKey
    ?`validation:${fingerprint(`${request.missionId}:${request.idempotencyKey}`)}`
    :`validation:${randomUUID()}`;
  if(request.idempotencyKey){
    const existing=await getMatchingValidation(id,requestFingerprint,true);
    if(existing)return existing;
  }
  const [mission,artifact,metadata]=await Promise.all([
    runtime.missions.get(request.missionId),
    runtime.artifacts.get(request.artifactId),
    runtime.artifacts.getMetadata?.(request.artifactId),
  ]);
  const checks: Array<{name:"expectedSha256"|"minBytes"|"maxBytes"|"containsText";passed:boolean;expected?:unknown;actual?:unknown;detail:string}>=[];
  let status:"passed"|"failed"|"unverified";
  let reason:string;
  let artifactSha256:string|undefined;
  const boundJobId=request.jobId??metadata?.jobId;

  if(!mission){
    status="failed";
    reason="Mission does not exist";
  }else if(!artifact){
    status="failed";
    reason="Artifact does not exist in the configured Artifact Store";
  }else{
    const bytes=await artifact.arrayBuffer();
    artifactSha256=sha256(bytes);
    if(!metadata?.missionId){
      status="unverified";
      reason="Artifact is not bound to a Mission in durable metadata";
    }else if(metadata.id!==request.artifactId){
      status="failed";
      reason="Artifact metadata is bound to a different Artifact ID";
    }else if(metadata.missionId!==request.missionId){
      status="failed";
      reason="Artifact is registered to a different Mission";
    }else if(request.jobId&&metadata.jobId!==request.jobId){
      status="failed";
      reason="Artifact is not registered to the requested Job";
    }else if(boundJobId&&!(await jobBelongsToMission(runtime,boundJobId,request.missionId))){
      status="failed";
      reason="Artifact Job is missing or belongs to a different Mission";
    }else if(metadata.sizeBytes!==bytes.byteLength){
      status="failed";
      reason="Stored Artifact bytes do not match the registered size";
    }else if(metadata?.sha256&&metadata.sha256!==artifactSha256){
      status="failed";
      reason="Stored Artifact bytes do not match the registered SHA-256";
    }else if(request.artifactSha256&&request.artifactSha256!==artifactSha256){
      status="failed";
      reason="Artifact SHA-256 differs from the requested exact Artifact binding";
    }else if(!request.checks){
      status="unverified";
      reason="No executable validation checks were supplied";
    }else{
      const result=evaluateArtifactValidationChecks(request.checks,bytes,artifact.type,artifactSha256);
      checks.push(...result.checks);
      status=result.unsupported.length?"unverified":checks.every((check)=>check.passed)?"passed":"failed";
      reason=result.unsupported.length
        ?`Validation capability is unavailable for: ${result.unsupported.join(", ")}`
        :checks.every((check)=>check.passed)?"All requested checks passed":"One or more requested checks failed";
    }
  }

  const result=ValidationResultSchema.parse({
    id,schemaVersion:"validation-v1",missionId:request.missionId,artifactId:request.artifactId,
    artifactSha256,requestFingerprint,jobId:boundJobId,checkpointId:request.checkpointId,
    status,checks,reason,createdAt,
  });
  const type=status==="passed"?"ValidationPassed":status==="failed"?"ValidationFailed":"ValidationUnverified";
  const event=createEvolutionEvent({
    id:`validation-result:${id}`,
    missionId:request.missionId,jobId:result.jobId,checkpointId:request.checkpointId,
    type,source:"backend-validation-runtime",
    payload:{validationId:id,validation:result},
  });
  try{await runtime.events.append(event);}
  catch(error){
    if(error instanceof EventEvidenceMirrorError||error instanceof EventEvidenceIdentityConflictError)throw error;
    try{
      const canonical=await getMatchingValidation(id,requestFingerprint,true);
      if(canonical)return canonical;
    }catch(readError){
      if(readError instanceof ValidationIdempotencyConflictError
        ||readError instanceof EventEvidenceMirrorError
        ||readError instanceof EventEvidenceIdentityConflictError)throw readError;
      throw new ValidationPersistenceUncertainError(id,readError);
    }
    if(error instanceof EventIdempotencyConflictError)throw error;
    throw new ValidationPersistenceUncertainError(id,error);
  }
  if(request.idempotencyKey){
    const canonical=await getMatchingValidation(id,requestFingerprint,false);
    if(canonical)return canonical;
  }
  return result;
}

export async function getValidation(id:string){
  const record=await getServerValidationResult(id);
  return record?ValidationResultSchema.parse(record):undefined;
}

// Compatibility shim for existing backend routes; the decision lives in Core.
export function canAcceptCheckpoint(validation:Pick<ValidationResult,"status"|"artifactId"|"artifactSha256"|"checks">){
  return canAcceptValidatedArtifact(validation);
}
