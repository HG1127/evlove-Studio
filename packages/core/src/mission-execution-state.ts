import type {EvolutionJob} from "@evolution/contracts";

export type MissionExecutionStatus="running"|"interrupted"|"unverified"|"idle"|"cancelled"|"failed"|"partial"|"waiting"|"stopped";
/** A saved Mission flag is not execution evidence. A newer terminal receipt wins
 * over stale local activity, but never over a later explicitly started attempt. */
export function missionExecutionStatus(input:{missionId:string;updatedAt:string;campaignStatus:string;
 running?:boolean;interrupted?:boolean;startedAt?:string;jobs?:readonly EvolutionJob[]}):MissionExecutionStatus{
 const jobs=(input.jobs??[]).filter(job=>job.missionId===input.missionId&&job.type==="campaign"
  &&job.idempotencyKey.startsWith(`workflow-control:${input.missionId}:`)
  &&Number.isFinite(Date.parse(job.createdAt))).toSorted((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
 // Equal creation times for distinct Jobs are ambiguous; do not pick a convenient verdict.
 const latest=jobs[0],ambiguous=latest&&jobs.some(job=>job.id!==latest.id&&Date.parse(job.createdAt)===Date.parse(latest.createdAt));
 const since=Math.max(Date.parse(input.updatedAt),input.startedAt?Date.parse(input.startedAt):-Infinity);
 if(latest&&!ambiguous&&Number.isFinite(since)&&Date.parse(latest.updatedAt)>=since){
  if(latest.status==="cancelled"||latest.status==="failed"||latest.status==="partial"||latest.status==="waiting")return latest.status;
  if(latest.status==="completed"&&input.campaignStatus==="running")return "stopped";
 }
 if(input.running)return "running";
 if(input.interrupted)return "interrupted";
 return input.campaignStatus==="running"?"unverified":"idle";
}
