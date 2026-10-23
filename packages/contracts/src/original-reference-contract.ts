import {z} from "zod";

/** Server-read immutable Original bytes, not a Candidate acceptance result. */
export const OriginalArtifactReferenceProofSchema=z.object({
  schemaVersion:z.literal("original-artifact-reference-v1"),
  missionId:z.string().min(1),sourceArtifactId:z.string().min(1),blobId:z.string().min(1),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().positive(),
}).strict();
export type OriginalArtifactReferenceProof=z.infer<typeof OriginalArtifactReferenceProofSchema>;
