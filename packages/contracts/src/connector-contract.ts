import {z} from "zod";
import {TargetLifecycleCapabilitiesSchema} from "./target-contract";

export const ConnectorTargetTypeSchema=z.enum(["agent","workflow","memory","api","database","saas","custom"]);
export type ConnectorTargetType=z.infer<typeof ConnectorTargetTypeSchema>;

export const ConnectorLifecycleOperationSchema=z.enum(["read","snapshot","mutate","validate","deploy","observe","rollback"]);
export type ConnectorLifecycleOperation=z.infer<typeof ConnectorLifecycleOperationSchema>;

export const ConnectorServerManifestSchema=z.object({
  id:z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  label:z.string().min(1).max(120),
  targetType:ConnectorTargetTypeSchema,
  baseUrl:z.string().url(),
  credentialEnv:z.string().min(1).max(120).regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  credentialVaultId:z.string().min(1).max(120).optional(),
  webhookSecretEnv:z.string().min(1).max(120).regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  webhookSecretVaultId:z.string().min(1).max(120).optional(),
  paths:z.partialRecord(ConnectorLifecycleOperationSchema,z.string().min(1).max(300)).default({}),
}).superRefine((value,ctx)=>{
  if(value.credentialEnv&&value.credentialVaultId)ctx.addIssue({code:"custom",path:["credentialVaultId"],message:"Use either credentialEnv or credentialVaultId, not both"});
  if(value.webhookSecretEnv&&value.webhookSecretVaultId)ctx.addIssue({code:"custom",path:["webhookSecretVaultId"],message:"Use either webhookSecretEnv or webhookSecretVaultId, not both"});
});
export type ConnectorServerManifest=z.infer<typeof ConnectorServerManifestSchema>;

export const ConnectorPublicManifestSchema=z.object({
  id:z.string(),
  label:z.string(),
  targetType:ConnectorTargetTypeSchema,
  lifecycle:TargetLifecycleCapabilitiesSchema,
  credentialConfigured:z.boolean(),
  webhookConfigured:z.boolean(),
  credentialProvider:z.enum(["none","env","vault"]).default("none"),
  webhookProvider:z.enum(["none","env","vault"]).default("none"),
});
export type ConnectorPublicManifest=z.infer<typeof ConnectorPublicManifestSchema>;

export const ConnectorTargetBindingSchema=z.object({
  connectorId:z.string().min(1),
  targetId:z.string().min(1),
});
export type ConnectorTargetBinding=z.infer<typeof ConnectorTargetBindingSchema>;

export const ConnectorTargetSnapshotBindingSchema=z.object({
  connectorId:z.string().min(1),
  targetId:z.string().min(1),
  versionRef:z.string().min(1),
  snapshotRef:z.string().optional(),
  artifactId:z.string().min(1),
  observedAt:z.string(),
});
export type ConnectorTargetSnapshotBinding=z.infer<typeof ConnectorTargetSnapshotBindingSchema>;

export const ConnectorCandidateBindingSchema=z.object({
  connectorId:z.string().min(1),
  targetId:z.string().min(1),
  baseVersionRef:z.string().min(1),
  versionRef:z.string().min(1),
  artifactFingerprint:z.string().min(1),
  snapshotRef:z.string().optional(),
  evidenceRefs:z.array(z.string()).default([]),
  observedAt:z.string(),
});
export type ConnectorCandidateBinding=z.infer<typeof ConnectorCandidateBindingSchema>;

export const ConnectorReleaseActionSchema=z.enum(["shadow","canary-5","canary-20","canary-50","promote","rollback"]);
export type ConnectorReleaseAction=z.infer<typeof ConnectorReleaseActionSchema>;
export const ConnectorReleaseReceiptSchema=z.object({
  effectiveAction:ConnectorReleaseActionSchema,
  trafficPercent:z.number().min(0).max(100),
  healthy:z.boolean(),
  observationStatus:z.enum(["observing","healthy","unhealthy"]),
  environment:z.string().min(1),
  stableDeploymentRef:z.string().min(1).optional(),
  latencyMs:z.number().nonnegative().optional(),
  sampleSize:z.number().int().nonnegative().optional(),
  windowMinutes:z.number().nonnegative().optional(),
});
export type ConnectorReleaseReceipt=z.infer<typeof ConnectorReleaseReceiptSchema>;

export const ConnectorRegistryCapabilitiesSchema=z.object({
  codeReady:z.literal(true),
  configured:z.boolean(),
  connectorCount:z.number().int().nonnegative(),
  fullLifecycleCount:z.number().int().nonnegative(),
  connectors:z.array(ConnectorPublicManifestSchema),
});
export type ConnectorRegistryCapabilities=z.infer<typeof ConnectorRegistryCapabilitiesSchema>;

export const ConnectorActionRequestSchema=z.object({
  connectorId:z.string().min(1),
  operation:ConnectorLifecycleOperationSchema,
  missionId:z.string().min(1).optional(),
  targetId:z.string().min(1),
  expectedVersionRef:z.string().optional(),
  idempotencyKey:z.string().min(1).optional(),
  payload:z.record(z.string(),z.unknown()).default({}),
});
export type ConnectorActionRequest=z.infer<typeof ConnectorActionRequestSchema>;

export const ConnectorActionResponseSchema=z.object({
  connectorId:z.string(),
  operation:ConnectorLifecycleOperationSchema,
  ok:z.boolean(),
  targetId:z.string(),
  versionRef:z.string().optional(),
  snapshotRef:z.string().optional(),
  deploymentRef:z.string().optional(),
  evidenceRefs:z.array(z.string()).default([]),
  output:z.record(z.string(),z.unknown()).optional(),
  observedAt:z.string(),
  note:z.string(),
});
export type ConnectorActionResponse=z.infer<typeof ConnectorActionResponseSchema>;

export const ConnectorWebhookEnvelopeSchema=z.object({
  missionId:z.string().min(1).optional(),
  targetId:z.string().min(1),
  event:z.string().min(1).max(120),
  versionRef:z.string().optional(),
  status:z.string().max(120).optional(),
  payload:z.record(z.string(),z.unknown()).default({}),
});
export type ConnectorWebhookEnvelope=z.infer<typeof ConnectorWebhookEnvelopeSchema>;

export const ConnectorWebhookReceiptSchema=z.object({
  accepted:z.boolean(),
  connectorId:z.string(),
  missionId:z.string().optional(),
  event:z.string(),
  observedAt:z.string(),
});
export type ConnectorWebhookReceipt=z.infer<typeof ConnectorWebhookReceiptSchema>;
