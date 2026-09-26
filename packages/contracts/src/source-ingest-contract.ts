import {z} from "zod";
import {ArtifactRoleSchema,SourceArtifactSchema} from "./evolve-schemas";
import {EvolutionJobSchema,EvolutionJobStatusSchema} from "./job-contract";
import {WorkflowRunCancelResultSchema} from "./workflow-contract";
import {ArtifactIdSchema} from "./artifact-contract";

export const SourceParseUploadMetadataSchema=z.object({
  name:z.string().min(1).max(255).refine((name)=>Boolean(name.trim())),
  mimeType:z.string().min(1).max(200).refine((mimeType)=>Boolean(mimeType.trim())),
  role:ArtifactRoleSchema,
  sessionId:z.string().trim().min(1).max(200).optional(),
  artifactId:ArtifactIdSchema,
  lastModified:z.number().int().min(0).max(8_640_000_000_000_000),
}).strict();
export type SourceParseUploadMetadata=z.infer<typeof SourceParseUploadMetadataSchema>;

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

export const SourceParseWorkflowInputV2Schema=SourceParseWorkflowInputSchema.extend({
  schemaVersion:z.literal("source-parse-workflow-v2"),
  generation:z.number().int().nonnegative(),
  contentSha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type SourceParseWorkflowInputV2=z.infer<typeof SourceParseWorkflowInputV2Schema>;
export const SourceParseWorkflowAnyInputSchema=z.union([
  SourceParseWorkflowInputV2Schema,SourceParseWorkflowInputSchema.strict(),
]);
export type SourceParseWorkflowAnyInput=z.infer<typeof SourceParseWorkflowAnyInputSchema>;

export const SourceParseJobInputIdentitySchema=SourceParseWorkflowInputSchema.pick({
  inputRef:true,outputRef:true,artifactId:true,name:true,mimeType:true,size:true,role:true,
}).extend({
  identityVersion:z.literal("parse-v2"),
  contentSha256:z.string().regex(/^[a-f0-9]{64}$/),
});

export const SourceParseResultIdentitySchema=SourceParseWorkflowInputSchema.pick({
  inputRef:true,artifactId:true,name:true,mimeType:true,size:true,role:true,
}).extend({
  identityVersion:z.literal("parse-v2"),
  resultSha256:z.string().regex(/^[a-f0-9]{64}$/),
});

export const SourceParseResultArtifactSchema=SourceArtifactSchema.extend({
  id:ArtifactIdSchema,
  name:z.string().min(1),
  role:ArtifactRoleSchema,
  mimeType:z.string().min(1),
  size:z.number().int().nonnegative(),
  inputMode:z.literal("upload"),
  storageRef:z.string().min(1),
});

export const SourceParseStartResponseSchema=z.object({
  jobId:z.string(),
  runId:z.string().min(1).optional(),
  artifactId:z.string(),
  status:z.enum(["queued","running","waiting","completed"]),
  reused:z.boolean().optional(),
}).superRefine((receipt,context)=>{
  if(receipt.status!=="completed"&&!receipt.runId){
    context.addIssue({code:"custom",path:["runId"],message:"Active Parse requires a durable Workflow runId"});
  }
});
export type SourceParseStartResponse=z.infer<typeof SourceParseStartResponseSchema>;

export const SourceParseStatusResponseSchema=z.object({
  job:EvolutionJobSchema,
  artifact:SourceArtifactSchema.optional(),
  resultIssue:z.string().min(1).max(500).optional(),
  resultIssueCode:z.enum(["temporary-storage-unavailable"]).optional(),
});
export type SourceParseStatusResponse=z.infer<typeof SourceParseStatusResponseSchema>;

export const SourceParseCancelResponseSchema=z.object({
  jobId:z.string().min(1),
  status:EvolutionJobStatusSchema,
  workflow:WorkflowRunCancelResultSchema,
});
export type SourceParseCancelResponse=z.infer<typeof SourceParseCancelResponseSchema>;

export const SourceParseListQuerySchema=z.object({
  sessionId:z.string().trim().min(1).max(200).optional(),
});
export type SourceParseListQuery=z.infer<typeof SourceParseListQuerySchema>;

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
