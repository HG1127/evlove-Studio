import type {EvolutionJob,EvolutionWorkflowRunInput} from "@evolution/contracts";
import {assertLabWorkflowPermitIdentity,labMissionStillArmed} from "./lab-workflow-permit";

export type LabDeadlineDecision=
  |{kind:"continue";remainingMs:number}
  |{kind:"stop";remainingMs:0;reason:"deadline"|"disarmed"|"job-terminal"};

const terminalStatuses=new Set<EvolutionJob["status"]>(["completed","partial","failed","cancelled"]);

/** Pure guard: deadline decisions use the real time captured in a durable Step. */
export function decideLabWorkflowDeadline(
  input:EvolutionWorkflowRunInput,job:EvolutionJob,nowMs=Date.now(),
):LabDeadlineDecision{
  const permit=assertLabWorkflowPermitIdentity(input,job,nowMs);
  if(!permit)throw Object.assign(new Error("Lab timeout requires an isolated Job-bound permit"),{code:"LAB_DEADLINE_PERMIT_REQUIRED"});
  const remaining=Math.max(0,Date.parse(permit.deadlineAt)-nowMs);
  if(terminalStatuses.has(job.status))return {kind:"stop",remainingMs:0,reason:"job-terminal"};
  if(remaining===0)return {kind:"stop",remainingMs:0,reason:"deadline"};
  if(!labMissionStillArmed(input.missionId))return {kind:"stop",remainingMs:0,reason:"disarmed"};
  return {kind:"continue",remainingMs:remaining};
}

/** Never sleep past the immutable deadline; keep non-Lab sleep unchanged. */
export function boundLabWorkflowSleep(requestedMs:number,decision:LabDeadlineDecision){
  if(decision.kind==="stop")return 0;
  if(!Number.isFinite(requestedMs)||requestedMs<=0)throw new Error("Invalid durable workflow sleep");
  return Math.max(1,Math.min(requestedMs,decision.remainingMs));
}
