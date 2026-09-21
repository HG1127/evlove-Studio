import {z} from "zod";

export const AcceptedArtifactRenderRequestSchema=z.object({
  missionId:z.string().min(1),
});
export type AcceptedArtifactRenderRequest=z.infer<typeof AcceptedArtifactRenderRequestSchema>;

export const AcceptedArtifactRenderReceiptSchema=z.object({
  sourceArtifactId:z.string(),
  artifactRef:z.string(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
  size:z.number().int().nonnegative(),
  name:z.string(),
});
export type AcceptedArtifactRenderReceipt=z.infer<typeof AcceptedArtifactRenderReceiptSchema>;

export const AcceptedArtifactRenderResponseSchema=z.object({
  missionId:z.string(),
  candidateId:z.string(),
  renderedCount:z.number().int().nonnegative(),
  receipts:z.array(AcceptedArtifactRenderReceiptSchema),
  observedAt:z.string(),
  note:z.string(),
});
export type AcceptedArtifactRenderResponse=z.infer<typeof AcceptedArtifactRenderResponseSchema>;
