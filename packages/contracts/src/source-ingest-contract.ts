import {z} from "zod";
import {ArtifactRoleSchema,SourceArtifactSchema} from "./evolve-schemas";
import {EvolutionJobSchema,EvolutionJobStatusSchema} from "./job-contract";
import {WorkflowRunCancelResultSchema} from "./workflow-contract";

export const SourceParseWorkflowInputSchema=z.object({
  jobId:z.string().min(1),
  inputRef:z.string().min(1),
  outputRef:z.string().min(1),
  artifactId:z.string().min(1),
  name:z.string().min(1),
  mimeType:z.string().min(1),
  size:z.number().int().nonnegative(),
  role:ArtifactRoleSchema,
  requestedAt:z.string(),
});
export type SourceParseWorkflowInput=z.infer<typeof SourceParseWorkflowInputSchema>;

export const SourceParseStartResponseSchema=z.object({
  jobId:z.string(),
  runId:z.string(),
  artifactId:z.string(),
  status:z.enum(["queued","running","waiting","completed"]),
  reused:z.boolean().optional(),
});
export type SourceParseStartResponse=z.infer<typeof SourceParseStartResponseSchema>;

export const SourceParseStatusResponseSchema=z.object({
  job:EvolutionJobSchema,
  artifact:SourceArtifactSchema.optional(),
});
export type SourceParseStatusResponse=z.infer<typeof SourceParseStatusResponseSchema>;

export const SourceParseCancelResponseSchema=z.object({
  jobId:z.string().min(1),
  status:EvolutionJobStatusSchema,
  workflow:WorkflowRunCancelResultSchema,
});
export type SourceParseCancelResponse=z.infer<typeof SourceParseCancelResponseSchema>;

export const SourceParseListResponseSchema=z.object({
  items:z.array(SourceParseStatusResponseSchema),
});
export type SourceParseListResponse=z.infer<typeof SourceParseListResponseSchema>;

export const SourceParseCapabilitiesSchema=z.object({
  available:z.boolean(),
  durable:z.boolean(),
  artifactStore:z.boolean(),
  serverNative:z.boolean(),
  supportedExtensions:z.array(z.string()),
  reason:z.string().optional(),
});
export type SourceParseCapabilities=z.infer<typeof SourceParseCapabilitiesSchema>;
