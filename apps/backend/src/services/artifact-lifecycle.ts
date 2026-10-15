import {createHash} from "node:crypto";
import {ArtifactReconcileRequestSchema,createEvolutionEvent,EvolutionEventSchema,type ArtifactRegistrationRequest,type ProductionRuntimePorts} from "@evolution/contracts";
import {getServerArtifactStore} from "./artifact-runtime";
import {appendEvidenceLedger} from "./evidence-ledger";

export type ArtifactRegistration=ArtifactRegistrationRequest;

export function isTextArtifactMimeType(value:string){
  const mimeType=value.split(";")[0].trim().toLowerCase();
  return mimeType.startsWith("text/")
    ||/^application\/(json|xml|[^/]+\+json|[^/]+\+xml)$/.test(mimeType);
}

function hash(content:string){
  return createHash("sha256").update(content).digest("hex");
}

export async function registerArtifact(input:ArtifactRegistration){
  const digest=hash(input.content);
  const artifactStore=getServerArtifactStore();
  await artifactStore.put(
    input.id,
    new Blob([input.content],{type:input.mimeType}),
    {missionId:input.missionId,jobId:input.jobId,kind:input.kind},
  );

  return {
    id:input.id,
    kind:input.kind,
    mimeType:input.mimeType,
    missionId:input.missionId,
    jobId:input.jobId,
    sha256:digest,
    size:Buffer.byteLength(input.content),
  };
}

export async function linkArtifactEvidence(
  runtime:ProductionRuntimePorts,
  input:{missionId:string;jobId?:string;artifactId:string;sha256:string;kind:string},
){
  const id=`artifact-registered:${input.missionId}:${input.artifactId}:${input.sha256}`;
  const stored=await runtime.events.get?.(id);
  const existing=stored===undefined?undefined:EvolutionEventSchema.parse(stored);
  if(existing&&existing.id!==id){
    throw new Error("Artifact registration Event lookup returned another identity");
  }
  // Reuse only the original timestamp. Strict persistence still compares every
  // expected field, so a conflicting binding or payload cannot become a replay.
  await runtime.events.append(createEvolutionEvent({
    id,at:existing?.at,
    missionId:input.missionId,
    jobId:input.jobId,
    type:"ArtifactRegistered",
    source:"backend-artifact-lifecycle",
    payload:{
      artifactId:input.artifactId,
      sha256:input.sha256,
      kind:input.kind,
    },
  }));
  const evidence=await appendEvidenceLedger({
    id:`artifact-registration:${input.artifactId}:${input.sha256}`,
    missionId:input.missionId,kind:"artifact",source:"backend-artifact-lifecycle",actor:"system",
    jobId:input.jobId,decision:"artifact-registered",
    payload:{artifactId:input.artifactId,sha256:input.sha256,kind:input.kind},
    artifactRefs:[input.artifactId],
  });

  return {...input,evidence};
}

export class ArtifactReconciliationError extends Error{
  constructor(readonly reason:"mission-missing"|"artifact-missing"|"binding-mismatch"|"hash-mismatch"){
    super(`Artifact reconciliation failed: ${reason}`);
    this.name="ArtifactReconciliationError";
  }
}

export async function reconcileArtifactRegistration(runtime:ProductionRuntimePorts,raw:unknown){
  const input=ArtifactReconcileRequestSchema.parse(raw);
  const [mission,metadata,artifact]=await Promise.all([
    runtime.missions.get(input.missionId),
    runtime.artifacts.getMetadata?.(input.artifactId),
    runtime.artifacts.get(input.artifactId),
  ]);
  if(!mission)throw new ArtifactReconciliationError("mission-missing");
  if(!metadata||!artifact)throw new ArtifactReconciliationError("artifact-missing");
  if(metadata.id!==input.artifactId||metadata.missionId!==input.missionId){
    throw new ArtifactReconciliationError("binding-mismatch");
  }
  if(metadata.jobId){
    const job=await runtime.jobs.get(metadata.jobId);
    if(!job||job.missionId!==input.missionId){
      throw new ArtifactReconciliationError("binding-mismatch");
    }
  }
  const bytes=await artifact.arrayBuffer();
  const sha256=createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  if(sha256!==metadata.sha256||bytes.byteLength!==metadata.sizeBytes){
    throw new ArtifactReconciliationError("hash-mismatch");
  }
  const linked=await linkArtifactEvidence(runtime,{
    missionId:input.missionId,artifactId:input.artifactId,sha256,
    kind:metadata.kind??"artifact",jobId:metadata.jobId,
  });
  return {missionId:input.missionId,artifactId:input.artifactId,sha256,sizeBytes:bytes.byteLength,
    evidenceId:linked.evidence.id,status:"reconciled" as const};
}
