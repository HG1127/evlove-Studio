import {createHash,randomUUID} from "node:crypto";
import {
  createEvolutionEvent,
  ValidationRequestSchema,
  ValidationResultSchema,
  type ArtifactValidationChecks,
  type ProductionRuntimePorts,
} from "@evolution/contracts";
import {EventEvidenceIdentityConflictError,mirrorEvolutionEventToEvidenceLedger} from "./evidence-ledger";
import {EventEvidenceMirrorError,EventIdempotencyConflictError} from "./event-persistence";
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
      const result=runChecks(request.checks,bytes,artifact.type);
      checks.push(...result.checks);
      status=result.unsupported.length?"unverified":checks.every((check)=>check.passed)?"passed":"failed";
      reason=result.unsupported.length
        ?`Validation capability is unavailable for: ${result.unsupported.join(", ")}`
        :checks.every((check)=>check.passed)?"All requested checks passed":"One or more requested checks failed";
    }
  }

  const result=ValidationResultSchema.parse({
    id,schemaVersion:"validation-v1",missionId:request.missionId,artifactId:request.artifactId,
    artifactSha256,requestFingerprint,jobId:request.jobId,checkpointId:request.checkpointId,
    status,checks,reason,createdAt,
  });
  const type=status==="passed"?"ValidationPassed":status==="failed"?"ValidationFailed":"ValidationUnverified";
  const event=createEvolutionEvent({
    id:`validation-result:${id}`,
    missionId:request.missionId,jobId:request.jobId,checkpointId:request.checkpointId,
    type,source:"backend-validation-runtime",
    payload:{validationId:id,validation:result},
  });
  try{await runtime.events.append(event);}
  catch(error){
    if(error instanceof EventIdempotencyConflictError&&request.idempotencyKey){
      const canonical=await getMatchingValidation(id,requestFingerprint,true);
      if(canonical)return canonical;
    }
    throw error;
  }
  if(request.idempotencyKey){
    const canonical=await getMatchingValidation(id,requestFingerprint,false);
    if(canonical)return canonical;
  }
  return result;
}

function runChecks(checks:ArtifactValidationChecks,bytes:ArrayBuffer,mimeType:string){
  const output:Array<{name:"expectedSha256"|"minBytes"|"maxBytes"|"containsText";passed:boolean;expected?:unknown;actual?:unknown;detail:string}>=[];
  const unsupported:string[]=[];
  const size=bytes.byteLength;
  const digest=sha256(bytes);
  if(checks.expectedSha256){
    output.push({name:"expectedSha256",passed:digest===checks.expectedSha256,expected:checks.expectedSha256,actual:digest,detail:digest===checks.expectedSha256?"Artifact hash matches":"Artifact hash does not match"});
  }
  if(checks.minBytes!==undefined){
    output.push({name:"minBytes",passed:size>=checks.minBytes,expected:checks.minBytes,actual:size,detail:size>=checks.minBytes?"Artifact meets minimum size":"Artifact is smaller than the required minimum"});
  }
  if(checks.maxBytes!==undefined){
    output.push({name:"maxBytes",passed:size<=checks.maxBytes,expected:checks.maxBytes,actual:size,detail:size<=checks.maxBytes?"Artifact is within maximum size":"Artifact exceeds the allowed maximum size"});
  }
  if(checks.containsText!==undefined){
    const textual=mimeType.startsWith("text/")||/json|xml|yaml|javascript|typescript/.test(mimeType);
    if(!textual){
      unsupported.push("containsText (non-text Artifact)");
    }else{
      try{
        const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
        const passed=text.includes(checks.containsText);
        output.push({name:"containsText",passed,expected:checks.containsText,actual:passed,detail:passed?"Required text was found":"Required text was not found"});
      }catch{
        unsupported.push("containsText (Artifact is not valid UTF-8 text)");
      }
    }
  }
  return {checks:output,unsupported};
}

export async function getValidation(id:string){
  const record=await getServerValidationResult(id);
  return record?ValidationResultSchema.parse(record):undefined;
}

export function canAcceptCheckpoint(validation:{status:string;artifactId:string;artifactSha256?:string}){
  return validation.status==="passed"&&Boolean(validation.artifactId&&validation.artifactSha256);
}
