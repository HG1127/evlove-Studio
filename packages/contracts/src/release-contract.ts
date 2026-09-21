import { z } from "zod";
import { ReleaseAdapterResultSchema } from "./evolve-schemas";

export const VercelReleaseActionSchema=z.enum(["shadow","canary-5","canary-20","canary-50","promote","rollback"]);
export type VercelReleaseAction=z.infer<typeof VercelReleaseActionSchema>;

export const VercelReleaseCapabilitiesSchema=z.object({
  provider:z.literal("vercel"),
  available:z.boolean(),
  readEnabled:z.boolean(),
  writeEnabled:z.boolean(),
  credentialStatus:z.enum(["ready","required"]),
  mode:z.enum(["preview-promote","progressive"]),
  rollingReleaseSupported:z.boolean(),
  rollingReleaseConfigured:z.boolean().default(false),
  rollingReleaseStages:z.array(z.number().min(0).max(100)).default([]),
  rollingReleaseReason:z.string().optional(),
  projectId:z.string().optional(),
  projectName:z.string().optional(),
  productionUrl:z.string().url().optional(),
  actions:z.array(VercelReleaseActionSchema),
});
export type VercelReleaseCapabilities=z.infer<typeof VercelReleaseCapabilitiesSchema>;

export const VercelReleaseHealthCheckSchema=z.object({
  path:z.string(),
  ok:z.boolean(),
  status:z.number().int().optional(),
  latencyMs:z.number().nonnegative(),
  error:z.string().optional(),
});
export const VercelReleaseHealthSchema=z.object({
  ready:z.boolean(),
  url:z.string().url().optional(),
  checkedAt:z.string(),
  latencyMs:z.number().nonnegative(),
  checks:z.array(VercelReleaseHealthCheckSchema),
  message:z.string(),
});
export type VercelReleaseHealth=z.infer<typeof VercelReleaseHealthSchema>;

export const VercelDeploymentSummarySchema=z.object({
  id:z.string(),
  url:z.string().url(),
  state:z.string(),
  target:z.string().optional(),
  createdAt:z.number().optional(),
  meta:z.record(z.string(),z.unknown()).optional(),
});
export type VercelDeploymentSummary=z.infer<typeof VercelDeploymentSummarySchema>;

export const VercelReleaseDeploymentsSchema=z.object({
  available:z.boolean(),
  deployments:z.array(VercelDeploymentSummarySchema),
  message:z.string(),
});
export type VercelReleaseDeployments=z.infer<typeof VercelReleaseDeploymentsSchema>;

export const VercelRollingReleaseStageSchema=z.object({
  targetPercentage:z.number().min(0).max(100),
  duration:z.number().nonnegative().optional(),
});
export type VercelRollingReleaseStage=z.infer<typeof VercelRollingReleaseStageSchema>;

export const VercelRollingReleaseSummarySchema=z.object({
  active:z.boolean(),
  enabled:z.boolean().default(false),
  advancementType:z.string().optional(),
  candidateDeploymentId:z.string().optional(),
  stableDeploymentId:z.string().optional(),
  currentStageIndex:z.number().int().nonnegative().optional(),
  currentPercentage:z.number().min(0).max(100).optional(),
  stages:z.array(VercelRollingReleaseStageSchema).default([]),
  status:z.string().optional(),
});
export type VercelRollingReleaseSummary=z.infer<typeof VercelRollingReleaseSummarySchema>;

export const VercelReleaseObservationSchema=z.object({
  provider:z.literal("vercel").default("vercel"),
  checkedAt:z.string(),
  productionDeployment:VercelDeploymentSummarySchema.optional(),
  boundDeployment:VercelDeploymentSummarySchema.optional(),
  productionHealth:VercelReleaseHealthSchema,
  boundHealth:VercelReleaseHealthSchema.optional(),
  rollingRelease:VercelRollingReleaseSummarySchema.optional(),
  errors:z.array(z.string()).default([]),
});
export type VercelReleaseObservation=z.infer<typeof VercelReleaseObservationSchema>;

export const VercelReleaseReconcileRequestSchema=z.object({
  missionId:z.string().min(1),
});
export type VercelReleaseReconcileRequest=z.infer<typeof VercelReleaseReconcileRequestSchema>;

export const VercelReleaseReconcileResponseSchema=z.object({
  disposition:z.enum(["safe-to-resume","terminal-live-decision","manual-check"]),
  reason:z.string(),
  observation:VercelReleaseObservationSchema,
  releaseStatus:z.enum(["idle","shadow","canary-5","canary-20","canary-50","promoted","rolled-back"]),
  recoveryStatus:z.enum(["pending","manual-check","reconciled"]).optional(),
});
export type VercelReleaseReconcileResponse=z.infer<typeof VercelReleaseReconcileResponseSchema>;

export const VercelReleaseActionRequestSchema=z.object({
  missionId:z.string().min(1),
  candidateId:z.string().min(1),
  action:VercelReleaseActionSchema,
  deploymentId:z.string().optional(),
});
export type VercelReleaseActionRequest=z.infer<typeof VercelReleaseActionRequestSchema>;

export const ReleaseApprovalRequestSchema=z.object({
  missionId:z.string().min(1),
  note:z.string().max(1000).optional(),
  ttlSeconds:z.number().int().min(300).max(86_400).optional(),
});
export type ReleaseApprovalRequest=z.infer<typeof ReleaseApprovalRequestSchema>;

export const ReleaseApprovalResponseSchema=z.object({
  missionId:z.string(),
  status:z.literal("approved"),
  approvedAt:z.string(),
  candidateId:z.string().optional(),
  actorId:z.string(),
  grantId:z.string().optional(),
  expiresAt:z.string().optional(),
});
export type ReleaseApprovalResponse=z.infer<typeof ReleaseApprovalResponseSchema>;

export const ReleaseApprovalRevokeRequestSchema=z.object({
  missionId:z.string().min(1),
  note:z.string().max(1000).optional(),
});
export type ReleaseApprovalRevokeRequest=z.infer<typeof ReleaseApprovalRevokeRequestSchema>;

export const ReleaseApprovalRevokeResponseSchema=z.object({
  missionId:z.string(),
  status:z.literal("revoked"),
  revokedAt:z.string(),
  revokedCount:z.number().int().nonnegative(),
  actorId:z.string(),
});
export type ReleaseApprovalRevokeResponse=z.infer<typeof ReleaseApprovalRevokeResponseSchema>;

export const VercelReleaseActionResponseSchema=ReleaseAdapterResultSchema.extend({
  provider:z.literal("vercel").default("vercel"),
  releaseMode:z.enum(["preview-promote","progressive"]).default("preview-promote"),
  deploymentUrl:z.string().url().optional(),
  productionUrl:z.string().url().optional(),
  rollingRelease:VercelRollingReleaseSummarySchema.optional(),
});
export type VercelReleaseActionResponse=z.infer<typeof VercelReleaseActionResponseSchema>;
