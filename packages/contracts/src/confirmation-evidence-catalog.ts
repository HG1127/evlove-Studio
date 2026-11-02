import {z} from "zod";
import {ConfirmationAdmissionRequestV2Schema} from "./confirmation-admission-contract";

const id=z.string().min(1).max(200),hash=z.string().regex(/^[a-f0-9]{64}$/);
const artifact=z.object({artifactId:id,sha256:hash}).strict();
/** A locator, not a caller-issued approval. Its exact hash must be pinned by the server registrar. */
export const ConfirmationEvidenceCatalogSchema=z.object({
  schemaVersion:z.literal("confirmation-evidence-catalog-v1"),
  workspaceId:id,missionId:id,missionScopeSha256:hash,
  request:ConfirmationAdmissionRequestV2Schema,
  plan:artifact,observations:z.array(artifact).min(3).max(96),
  artifacts:z.array(artifact).min(1).max(512),
  sources:z.array(z.object({sourceArtifactId:id,...artifact.shape,sizeBytes:z.number().int().nonnegative()}).strict()).min(1).max(64),
  preregistrationSha256:hash,oracleApprovalSha256:hash,
}).strict().superRefine((c,ctx)=>{
  for(const [field,values] of [["observations",c.observations.map(a=>a.artifactId)],
    ["artifacts",c.artifacts.map(a=>a.sha256)],["sources",c.sources.map(a=>a.sourceArtifactId)]] as const){
    if(new Set(values).size!==values.length)ctx.addIssue({code:"custom",path:[field],message:"Duplicate evidence identity"});
  }
  const refs=[c.plan,...c.observations,...c.artifacts,...c.sources];
  for(const ref of refs)if(refs.some(other=>other.artifactId===ref.artifactId&&other.sha256!==ref.sha256))
    ctx.addIssue({code:"custom",message:"One Artifact ID cannot identify different bytes"});
});
export const ConfirmationServerTrustSchema=z.object({
  schemaVersion:z.literal("confirmation-server-trust-v1"),
  missions:z.array(z.object({missionId:id,catalogArtifactId:id,catalogSha256:hash}).strict()).min(1).max(64),
}).strict().refine(t=>new Set(t.missions.map(m=>m.missionId)).size===t.missions.length,"Duplicate trusted Mission");
export type ConfirmationEvidenceCatalog=z.infer<typeof ConfirmationEvidenceCatalogSchema>;
