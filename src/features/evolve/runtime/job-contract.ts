import type { EvidenceJobRecord } from "./evidence-job-store";
import type { ParseJobRecord } from "./parse-job-store";
import type { RunTaskRecord } from "./run-manager";
import { EvolutionJobSchema, PRODUCTION_SCHEMA_VERSIONS, type EvolutionJob, type EvolutionJobType } from "@evolution/contracts";

export {
  EvolutionJobSchema,
  EvolutionJobStatusSchema,
  EvolutionJobTypeSchema,
} from "@evolution/contracts";
export type {
  EvolutionJob,
  EvolutionJobStatus,
  EvolutionJobType,
  JobStorePort,
} from "@evolution/contracts";

function key(parts: Array<string|number|undefined>) { return parts.filter((v)=>v!==undefined).join(":"); }
function jobTypeFromEvidence(kind: EvidenceJobRecord["kind"]): EvolutionJobType {
  if (["build","browser-smoke","e2e","screenshot","visual-judge"].includes(kind)) return kind as EvolutionJobType;
  return "other";
}

export function parseJobAsEvolutionJob(job: ParseJobRecord): EvolutionJob {
  return EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,id:job.id,type:"parse",
    status:job.status==="queued"?"queued":job.status==="parsing"?"running":job.status==="ready"?"completed":"failed",
    label:`解析 · ${job.name}`,idempotencyKey:key(["parse",job.id,job.generation]),generation:job.generation,attempts:job.attempts,
    inputRef:job.name,outputRef:job.artifact?.id,error:job.error,createdAt:job.createdAt,updatedAt:job.updatedAt,
  });
}

export function evidenceJobAsEvolutionJob(job: EvidenceJobRecord): EvolutionJob {
  return EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,id:job.id,missionId:job.projectId,type:jobTypeFromEvidence(job.kind),
    status:job.status==="ready"?"completed":job.status==="unavailable"?"waiting":job.status,
    label:job.label,idempotencyKey:key(["evidence",job.id,job.fingerprint,job.generation]),generation:job.generation,attempts:job.attempts,
    inputRef:job.scope,outputRef:job.artifactHash,error:job.error,createdAt:job.createdAt,updatedAt:job.updatedAt,
  });
}

export function runTaskAsEvolutionJob(job: RunTaskRecord): EvolutionJob {
  return EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,id:`run:${job.projectId}`,missionId:job.projectId,
    type:job.kind==="campaign"?"campaign":"mission-action",status:job.interrupted?"waiting":"running",label:job.label,
    idempotencyKey:key(["run",job.projectId,job.kind,job.actionId,job.startedAt]),generation:0,attempts:1,
    inputRef:job.actionId,progress:job.progress?{done:job.progress.done,total:job.progress.total,percent:job.progress.percent,detail:job.progress.detail}:undefined,
    createdAt:job.startedAt,startedAt:job.startedAt,heartbeatAt:job.heartbeatAt,updatedAt:job.heartbeatAt,
  });
}
