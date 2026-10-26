import {ArtifactMetadataSchema,RepairEvidenceArchiveInputSchema,RepairEvidenceReferenceSchema,RepairFeedbackEvidenceSchema,type RepairEvidenceArchiveInput} from "@evolution/contracts";
import {getServerArtifactStore} from "./artifact-runtime";
import {serverArtifactSha256} from "./server-experiment-artifacts";

/** Immutable private evidence bytes, not a second in-Mission copy of every rendered body. */
export async function archiveServerRepairEvidence(raw:RepairEvidenceArchiveInput){
  const input=RepairEvidenceArchiveInputSchema.parse(raw),store=getServerArtifactStore();
  if(!store.getMetadata)throw new Error("Repair evidence metadata readback unavailable");
  const blob=new Blob([input.content],{type:"application/json"});
  if(await serverArtifactSha256(await blob.arrayBuffer())!==input.sha256)throw new Error("Repair evidence SHA-256 mismatch");
  const body=RepairFeedbackEvidenceSchema.parse(JSON.parse(input.content));
  if(body.version!=="repair-feedback-evidence-v1"||body.missionId!==input.missionId||body.candidateId!==input.candidateId
    ||body.attempt!==input.attempt||body.phase!==input.phase)throw new Error("Repair evidence body binding mismatch");
  const artifactId=`candidate-repair-evidence-${input.sha256}`,kind="candidate-repair-evidence";
  const checkMetadata=(rawMetadata:unknown)=>{
    const metadata=ArtifactMetadataSchema.parse(rawMetadata);
    if(metadata.id!==artifactId||metadata.missionId!==input.missionId||metadata.kind!==kind
      ||metadata.mimeType!==blob.type||metadata.sha256!==input.sha256||metadata.sizeBytes!==input.size)throw new Error("Repair evidence stored binding mismatch");
    return metadata;
  };
  const prior=await store.getMetadata(artifactId);
  if(prior)checkMetadata(prior);
  else await store.put(artifactId,blob,{missionId:input.missionId,kind});
  const read=await store.get(artifactId),metadata=checkMetadata(await store.getMetadata(artifactId));
  if(!read||read.size!==input.size||await serverArtifactSha256(await read.arrayBuffer())!==input.sha256)throw new Error("Repair evidence exact-byte readback failed");
  return RepairEvidenceReferenceSchema.parse({version:"repair-evidence-reference-v1",artifactId,missionId:input.missionId,candidateId:input.candidateId,
    sha256:metadata.sha256,size:metadata.sizeBytes,mimeType:"application/json"});
}
