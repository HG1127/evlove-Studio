import {z} from "zod";
import {CampaignCheckpointPhaseSchema} from "./evolve-schemas";

export const MAX_BINARY_ARTIFACT_BYTES=20*1024*1024;
export const ArtifactIdSchema=z.string().min(1).max(200);
export const BinaryArtifactUploadMetadataSchema=z.object({
  id:ArtifactIdSchema,
  mimeType:z.string().min(1).max(200),
}).strict();

export const ArtifactBindingSchema=z.object({
  missionId:z.string().min(1).optional(),
  jobId:z.string().min(1).optional(),
  kind:z.string().min(1).max(80).optional(),
}).strict();
export type ArtifactBinding=z.infer<typeof ArtifactBindingSchema>;

export const ArtifactRegistrationRequestSchema=z.object({
  id:ArtifactIdSchema,
  missionId:z.string().min(1).max(200).optional(),
  jobId:z.string().min(1).max(200).optional(),
  kind:z.string().min(1).max(80).default("source"),
  mimeType:z.string().min(1).max(200).default("text/plain"),
  content:z.string().max(5_242_880),
}).strict().refine((input)=>new TextEncoder().encode(input.content).byteLength<=5_242_880,{
  message:"Artifact registration content exceeds 5 MiB",
  path:["content"],
});
export type ArtifactRegistrationRequest=z.infer<typeof ArtifactRegistrationRequestSchema>;

export const ArtifactReconcileRequestSchema=z.object({
  missionId:z.string().min(1),
  artifactId:z.string().min(1),
}).strict();
export type ArtifactReconcileRequest=z.infer<typeof ArtifactReconcileRequestSchema>;

export const ArtifactBlobCleanupRequestSchema=z.object({
  limit:z.number().int().min(1).max(100).default(25),
  minAgeSeconds:z.number().int().min(60).max(86_400).default(300),
  dryRun:z.boolean().default(false),
}).strict();
export type ArtifactBlobCleanupRequest=z.infer<typeof ArtifactBlobCleanupRequestSchema>;

export const ArtifactBlobTombstoneRowSchema=z.object({
  artifact_id:ArtifactIdSchema,
  bucket:z.string().min(1),
  object_path:z.string().min(1),
  deleted_at:z.string().datetime(),
});
export type ArtifactBlobTombstoneRow=z.infer<typeof ArtifactBlobTombstoneRowSchema>;
export const ArtifactBlobLiveRowSchema=z.object({id:ArtifactIdSchema});
export const ArtifactBlobCleanupMarkerRowSchema=z.object({artifact_id:ArtifactIdSchema});
export const ArtifactBlobExistsSchema=z.boolean();

export const ArtifactMetadataSchema=z.object({
  id:z.string().min(1),
  schemaVersion:z.literal("artifact-v1"),
  missionId:z.string().min(1).optional(),
  jobId:z.string().min(1).optional(),
  kind:z.string().min(1).max(80).optional(),
  bucket:z.string().min(1),
  objectPath:z.string().min(1),
  mimeType:z.string().min(1),
  sizeBytes:z.number().int().nonnegative(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
  createdAt:z.string().datetime(),
  updatedAt:z.string().datetime(),
});
export type ArtifactMetadata=z.infer<typeof ArtifactMetadataSchema>;

export const ArtifactValidationChecksSchema=z.object({
  expectedSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  minBytes:z.number().int().nonnegative().optional(),
  maxBytes:z.number().int().positive().optional(),
  containsText:z.string().min(1).max(4000).optional(),
}).strict().refine((checks)=>Object.keys(checks).length>0,{message:"At least one executable validation check is required"});
export type ArtifactValidationChecks=z.infer<typeof ArtifactValidationChecksSchema>;

export const ValidationRequestSchema=z.object({
  missionId:z.string().min(1),
  artifactId:z.string().min(1),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  jobId:z.string().min(1).optional(),
  checkpointId:z.string().min(1).optional(),
  idempotencyKey:z.string().min(1).max(200).optional(),
  checks:ArtifactValidationChecksSchema.optional(),
}).strict();
export type ValidationRequest=z.infer<typeof ValidationRequestSchema>;

export const ValidationCheckResultSchema=z.object({
  name:z.enum(["expectedSha256","minBytes","maxBytes","containsText"]),
  passed:z.boolean(),
  expected:z.unknown().optional(),
  actual:z.unknown().optional(),
  detail:z.string(),
});

export const ValidationResultSchema=z.object({
  id:z.string().min(1),
  schemaVersion:z.literal("validation-v1"),
  missionId:z.string().min(1),
  artifactId:z.string().min(1),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  requestFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  jobId:z.string().min(1).optional(),
  checkpointId:z.string().min(1).optional(),
  status:z.enum(["passed","failed","unverified"]),
  checks:z.array(ValidationCheckResultSchema),
  reason:z.string(),
  createdAt:z.string().datetime(),
});
export type ValidationResult=z.infer<typeof ValidationResultSchema>;

export const CheckpointAcceptRequestSchema=z.object({
  validationId:z.string().min(1),
}).strict();
export type CheckpointAcceptRequest=z.infer<typeof CheckpointAcceptRequestSchema>;

export const CheckpointValidateRequestSchema=z.object({
  missionId:z.string().min(1),
  checkpointId:z.string().min(1),
  artifactId:z.string().min(1),
  validationId:z.string().min(1),
}).strict();
export type CheckpointValidateRequest=z.infer<typeof CheckpointValidateRequestSchema>;

export const CheckpointCreateRequestSchema=z.object({
  missionId:z.string().min(1),
  round:z.number().int().min(0),
  completedPhase:CampaignCheckpointPhaseSchema,
}).strict();
export type CheckpointCreateRequest=z.infer<typeof CheckpointCreateRequestSchema>;
