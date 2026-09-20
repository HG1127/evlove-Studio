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

export const VercelReleaseActionRequestSchema=z.object({
  missionId:z.string().min(1),
  candidateId:z.string().min(1),
  action:VercelReleaseActionSchema,
  deploymentId:z.string().optional(),
});
export type VercelReleaseActionRequest=z.infer<typeof VercelReleaseActionRequestSchema>;

export const VercelReleaseActionResponseSchema=ReleaseAdapterResultSchema.extend({
  provider:z.literal("vercel").default("vercel"),
  releaseMode:z.enum(["preview-promote","progressive"]).default("preview-promote"),
  deploymentUrl:z.string().url().optional(),
  productionUrl:z.string().url().optional(),
});
export type VercelReleaseActionResponse=z.infer<typeof VercelReleaseActionResponseSchema>;
