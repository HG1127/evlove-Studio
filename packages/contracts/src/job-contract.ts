import { z } from "zod";
import { PRODUCTION_SCHEMA_VERSIONS } from "./production-contracts";

export const EvolutionJobStatusSchema = z.enum(["queued","running","waiting","completed","partial","failed","cancelled"]);
export type EvolutionJobStatus = z.infer<typeof EvolutionJobStatusSchema>;

export const EvolutionJobTypeSchema = z.enum([
  "parse","mission-action","campaign","build","browser-smoke","e2e","screenshot","visual-judge","materialize","release","other",
]);
export type EvolutionJobType = z.infer<typeof EvolutionJobTypeSchema>;

export const EvolutionJobSchema = z.object({
  schemaVersion: z.literal(PRODUCTION_SCHEMA_VERSIONS.job),
  id: z.string(),
  missionId: z.string().optional(),
  type: EvolutionJobTypeSchema,
  status: EvolutionJobStatusSchema,
  label: z.string(),
  idempotencyKey: z.string(),
  generation: z.number().int().min(0).default(0),
  attempts: z.number().int().min(0).default(0),
  priority: z.number().int().min(0).max(100).default(50),
  checkpointId: z.string().optional(),
  inputRef: z.string().optional(),
  outputRef: z.string().optional(),
  metadata:z.record(z.string(),z.unknown()).optional(),
  progress: z.object({ done:z.number().optional(), total:z.number().optional(), percent:z.number().optional(), detail:z.string().optional() }).optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  heartbeatAt: z.string().optional(),
  finishedAt: z.string().optional(),
  updatedAt: z.string(),
});
export type EvolutionJob = z.infer<typeof EvolutionJobSchema>;

export const EvolutionJobCreateRequestSchema=z.object({
  idempotencyKey:z.string().min(1).max(200),
  missionId:z.string().min(1).optional(),
  type:EvolutionJobTypeSchema,
  label:z.string().min(1).max(200),
  priority:z.number().int().min(0).max(100).default(50),
  inputRef:z.string().min(1).optional(),
  metadata:z.record(z.string(),z.unknown()).default({}),
}).strict().refine((input)=>new TextEncoder().encode(JSON.stringify(input.metadata)).byteLength<=32_768,{
  message:"Job metadata exceeds 32 KiB",path:["metadata"],
});
export type EvolutionJobCreateRequest=z.infer<typeof EvolutionJobCreateRequestSchema>;

export const EvolutionJobTransitionRequestSchema=z.object({
  status:EvolutionJobStatusSchema,
  detail:z.string().max(2000).optional(),
}).strict();
export type EvolutionJobTransitionRequest=z.infer<typeof EvolutionJobTransitionRequestSchema>;

export const JobReconcileRequestSchema=z.object({
  missionId:z.string().min(1).optional(),
  minAgeSeconds:z.number().int().min(60).max(86_400).default(600),
  limit:z.number().int().min(1).max(100).default(100),
  repair:z.boolean().default(false),
}).strict();
export type JobReconcileRequest=z.infer<typeof JobReconcileRequestSchema>;

export interface JobStorePort {
  list(missionId?: string): Promise<EvolutionJob[]>;
  get(id: string): Promise<EvolutionJob | undefined>;
  put(job: EvolutionJob): Promise<void>;
  cancel(id: string): Promise<void>;
}
