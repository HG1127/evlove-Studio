import { z } from "zod";
import { SecurityCapabilitiesSchema } from "./security-contract";

export const EvolutionWorkflowStatusSchema = z.enum([
  "queued",
  "running",
  "waiting-action",
  "waiting-human",
  "completed",
  "blocked",
  "failed",
]);
export type EvolutionWorkflowStatus = z.infer<typeof EvolutionWorkflowStatusSchema>;

export const EvolutionWorkflowStartRequestSchema = z.object({
  missionId: z.string().min(1),
});
export type EvolutionWorkflowStartRequest = z.infer<typeof EvolutionWorkflowStartRequestSchema>;

export const EvolutionWorkflowRunInputSchema = z.object({
  missionId: z.string().min(1),
  controlJobId: z.string().min(1),
  requestedAt: z.string(),
});
export type EvolutionWorkflowRunInput = z.infer<typeof EvolutionWorkflowRunInputSchema>;

export const EvolutionWorkflowResultSchema = z.object({
  missionId: z.string(),
  controlJobId: z.string(),
  status: EvolutionWorkflowStatusSchema,
  iterations: z.number().int().min(0),
  nextAction: z.string().optional(),
  checkpointId: z.string().optional(),
  reason: z.string().optional(),
});
export type EvolutionWorkflowResult = z.infer<typeof EvolutionWorkflowResultSchema>;

export const EvolutionWorkflowStartResponseSchema = z.object({
  missionId: z.string(),
  controlJobId: z.string(),
  runId: z.string(),
  status: z.literal("queued"),
});
export type EvolutionWorkflowStartResponse = z.infer<typeof EvolutionWorkflowStartResponseSchema>;

export const EvolutionWorkflowCapabilitiesSchema=z.object({
  available:z.boolean(),
  fullAuto:z.boolean(),
  durable:z.boolean(),
  serverAi:z.boolean(),
  backend:z.object({
    dataPlaneConfigured:z.boolean().default(false),
    secureDataPlaneCredential:z.boolean().default(false),
    httpDataPlaneCodeReady:z.boolean().default(false),
    artifactStoreConfigured:z.boolean().default(false),
    sourceParseCodeReady:z.boolean().default(false),
    sourceParseConfigured:z.boolean().default(false),
    serverAiCodeReady:z.boolean().default(false),
    sandboxCodeReady:z.boolean().default(false),
    browserCodeReady:z.boolean().default(false),
    releaseCodeReady:z.boolean().default(false),
    gitTargetCodeReady:z.boolean().default(false),
    gitTargetConfigured:z.boolean().default(false),
    gitWebhookConfigured:z.boolean().default(false),
    targetProxyCodeReady:z.boolean().default(false),
    targetRunConfigured:z.boolean().default(false),
    targetReleaseConfigured:z.boolean().default(false),
    securityCodeReady:z.boolean().default(false),
    securityConfigured:z.boolean().default(false),
    securityProductionSafe:z.boolean().default(false),
  }).prefault({}),
  closure:z.object({
    codeReady:z.boolean().default(false),
    offlineFullAuto:z.boolean().default(false),
    onlineFullAuto:z.boolean().default(false),
    releaseOrchestrationReady:z.boolean().default(false),
    releaseReconciliationReady:z.boolean().default(false),
    onlinePostApprovalAuto:z.boolean().default(false),
    configBlocked:z.array(z.object({capability:z.string(),reason:z.string()})).default([]),
    externalCapabilityBlocked:z.array(z.object({capability:z.string(),reason:z.string()})).default([]),
  }).prefault({}),
  serverNativeActions:z.array(z.string()),
  conditionalActions:z.array(z.string()).default([]),
  blockedActions:z.array(z.object({action:z.string(),reason:z.string()})).default([]),
  migrationPendingActions:z.array(z.string()).default([]),
  pendingActions:z.array(z.string()),
});
export type EvolutionWorkflowCapabilities=z.infer<typeof EvolutionWorkflowCapabilitiesSchema>;

export const EvolutionBackendHealthSchema=z.object({
  checkedAt:z.string(),
  dataPlane:z.object({
    configured:z.boolean(),
    secureCredential:z.boolean().default(false),
    credentialMode:z.enum(["secret","publishable","missing"]).default("missing"),
    database:z.boolean(),
    storage:z.boolean(),
    tables:z.object({
      missions:z.boolean(),
      jobs:z.boolean(),
      events:z.boolean(),
      artifacts:z.boolean(),
    }),
    message:z.string(),
  }),
  httpDataPlane:z.object({codeReady:z.boolean()}),
  sourceParse:z.object({codeReady:z.boolean(),configured:z.boolean(),durable:z.boolean()}),
  serverAi:z.object({codeReady:z.boolean(),configured:z.boolean()}),
  sandbox:z.object({codeReady:z.boolean()}),
  browser:z.object({codeReady:z.boolean()}),
  release:z.object({codeReady:z.boolean(),writeConfigured:z.boolean()}),
  git:z.object({codeReady:z.boolean(),configured:z.boolean(),webhookConfigured:z.boolean()}),
  targetProxy:z.object({codeReady:z.boolean(),runConfigured:z.boolean(),releaseConfigured:z.boolean(),credentialConfigured:z.boolean()}),
  security:SecurityCapabilitiesSchema,
});
export type EvolutionBackendHealth=z.infer<typeof EvolutionBackendHealthSchema>;
