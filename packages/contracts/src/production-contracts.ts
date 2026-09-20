import { z } from "zod";
import { EvolveProjectSchema, type EvolveProject } from "./evolve-schemas";

export const PRODUCTION_SCHEMA_VERSIONS = {
  mission: "mission-v1",
  job: "job-v1",
  event: "event-v1",
  target: "target-v1",
  artifact: "artifact-v1",
  evidence: "evidence-v1",
  harness: "harness-v1",
} as const;

export const MissionEnvelopeSchema = z.object({
  schemaVersion: z.literal(PRODUCTION_SCHEMA_VERSIONS.mission),
  missionId: z.string(),
  revision: z.number().int().min(0),
  payload: EvolveProjectSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MissionEnvelope = z.infer<typeof MissionEnvelopeSchema>;

export function missionEnvelope(project: EvolveProject, revision = 0): MissionEnvelope {
  return MissionEnvelopeSchema.parse({
    schemaVersion: PRODUCTION_SCHEMA_VERSIONS.mission,
    missionId: project.id,
    revision,
    payload: project,
    createdAt: project.updatedAt,
    updatedAt: project.updatedAt,
  });
}

export const PRODUCTION_BOUNDARIES = [
  { id:"harness-executor", title:"Harness Action Executor", contract:"plan → execute(action) → outcome", ready:true },
  { id:"store-port", title:"Storage Ports", contract:"Mission / Job / Artifact / Event repositories", ready:true },
  { id:"job-contract", title:"Unified Job Contract", contract:"queued → running → waiting/completed/failed/cancelled", ready:true },
  { id:"event-contract", title:"Event Contract", contract:"append-only mission/job/action events", ready:true },
  { id:"target-lifecycle", title:"Target Lifecycle Contract", contract:"read → snapshot → mutate → validate → deploy → observe → rollback", ready:true },
  { id:"schema-version", title:"Versioned Core Schemas", contract:"mission-v1 / job-v1 / event-v1 / target-v1", ready:true },
] as const;

export function productionBoundaryReady() {
  return PRODUCTION_BOUNDARIES.every((item) => item.ready);
}
