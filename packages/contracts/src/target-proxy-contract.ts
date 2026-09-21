import { z } from "zod";
import { CandidateSchema, ReleaseAdapterResultSchema, TargetRunResultSchema, TestCaseSchema } from "./evolve-schemas";

export const TargetProxyArtifactSchema=z.object({
  name:z.string(),
  content:z.string(),
});

export const TargetRunProxyRequestSchema=z.object({
  projectId:z.string().min(1),
  connectionId:z.string().min(1),
  testCase:TestCaseSchema,
  artifact:TargetProxyArtifactSchema.optional(),
  archiveBase64:z.string().optional(),
  variant:CandidateSchema.nullable().optional(),
});
export type TargetRunProxyRequest=z.infer<typeof TargetRunProxyRequestSchema>;
export const TargetRunProxyResponseSchema=TargetRunResultSchema;

export const TargetReleaseProxyRequestSchema=z.object({
  projectId:z.string().min(1),
  connectionId:z.string().min(1),
  candidate:CandidateSchema,
  action:z.enum(["shadow","canary-5","canary-20","canary-50","promote","rollback"]),
});
export type TargetReleaseProxyRequest=z.infer<typeof TargetReleaseProxyRequestSchema>;
export const TargetReleaseProxyResponseSchema=ReleaseAdapterResultSchema;

export const TargetProxyCapabilitiesSchema=z.object({
  codeReady:z.boolean(),
  runConfigured:z.boolean(),
  releaseConfigured:z.boolean(),
  credentialConfigured:z.boolean(),
});
export type TargetProxyCapabilities=z.infer<typeof TargetProxyCapabilitiesSchema>;
