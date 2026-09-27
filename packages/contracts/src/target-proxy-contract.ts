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

export const TargetReleaseArtifactSchema=z.object({
  sourceArtifactId:z.string().min(1),
  snapshotHash:z.string().min(1),
  name:z.string().min(1),
  mimeType:z.string().min(1),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
  size:z.number().int().nonnegative(),
  contentBase64:z.string().min(1),
});
export type TargetReleaseArtifact=z.infer<typeof TargetReleaseArtifactSchema>;
export const TargetReleaseProxyRequestSchema=z.object({
  projectId:z.string().min(1),
  connectionId:z.string().min(1),
  candidate:CandidateSchema,
  frozenArtifacts:z.array(TargetReleaseArtifactSchema).optional(),
  action:z.enum(["shadow","canary-5","canary-20","canary-50","promote","rollback"]),
});
export type TargetReleaseProxyRequest=z.infer<typeof TargetReleaseProxyRequestSchema>;
export const TargetReleaseProxyResponseSchema=ReleaseAdapterResultSchema;

export const TargetObserveProxyRequestSchema=z.object({
  projectId:z.string().min(1),
  connectionId:z.string().min(1),
  candidate:CandidateSchema,
  deploymentId:z.string().optional(),
  stableDeploymentId:z.string().optional(),
  expectedArtifactHashes:z.array(z.object({sourceArtifactId:z.string(),contentHash:z.string()})).default([]),
  expectedArtifactByteHashes:z.array(z.object({sourceArtifactId:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)})).min(1),
  recoveryAction:z.enum(["shadow","canary-5","canary-20","canary-50","promote","rollback"]).optional(),
  healthPath:z.string().startsWith("/").max(300).optional(),
});
export type TargetObserveProxyRequest=z.infer<typeof TargetObserveProxyRequestSchema>;
export const TargetObserveProxyResponseSchema=ReleaseAdapterResultSchema.extend({
  evidenceMode:z.literal("live"),
  effectiveAction:z.enum(["shadow","canary-5","canary-20","canary-50","promote","rollback"]),
  deploymentId:z.string().min(1),
  observedAt:z.string().min(1),
});

export const TargetProxyCapabilitiesSchema=z.object({
  codeReady:z.boolean(),
  runConfigured:z.boolean(),
  releaseConfigured:z.boolean(),
  observeConfigured:z.boolean().default(false),
  credentialConfigured:z.boolean(),
});
export type TargetProxyCapabilities=z.infer<typeof TargetProxyCapabilitiesSchema>;
