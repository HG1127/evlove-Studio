import { z } from "zod";
import { PRODUCTION_SCHEMA_VERSIONS } from "./production-contracts";

export const EvolutionEventTypeSchema = z.enum([
  "MissionCreated","MissionUpdated","ActionPlanned","ActionStarted","ActionCompleted","ActionFailed",
  "JobQueued","JobStarted","JobProgress","JobCompleted","JobFailed","CheckpointCreated",
  "ArtifactUploaded","ArtifactRegistered","ArtifactParsed","CandidateCreated","ValidationCompleted","CheckpointAccepted","CheckpointRejected","ValidationPassed","ValidationFailed","ValidationUnverified","JobUpdated","ReleaseChanged","LessonCreated","AttentionRequired",
]);
export type EvolutionEventType = z.infer<typeof EvolutionEventTypeSchema>;

export const EvolutionEventSchema = z.object({
  schemaVersion:z.literal(PRODUCTION_SCHEMA_VERSIONS.event),
  id:z.string(),missionId:z.string().optional(),type:EvolutionEventTypeSchema,source:z.string(),
  jobId:z.string().optional(),checkpointId:z.string().optional(),causationId:z.string().optional(),correlationId:z.string().optional(),
  payload:z.record(z.string(),z.unknown()).default({}),at:z.string(),
});
export type EvolutionEvent = z.infer<typeof EvolutionEventSchema>;

export function createEvolutionEvent(input: Omit<EvolutionEvent,"schemaVersion"|"id"|"at"> & {id?:string;at?:string}) {
  return EvolutionEventSchema.parse({...input,schemaVersion:PRODUCTION_SCHEMA_VERSIONS.event,id:input.id??`evt-${crypto.randomUUID()}`,at:input.at??new Date().toISOString()});
}

export interface EventStorePort {
  append(event: EvolutionEvent): Promise<void>;
  list(missionId?: string, limit?: number): Promise<EvolutionEvent[]>;
}
