import { z } from "zod";

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
  closure:z.object({
    codeReady:z.boolean().default(false),
    offlineFullAuto:z.boolean().default(false),
    onlineFullAuto:z.boolean().default(false),
    releaseOrchestrationReady:z.boolean().default(false),
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
