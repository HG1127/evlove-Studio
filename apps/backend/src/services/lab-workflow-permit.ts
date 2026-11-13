import {LabWorkflowPermitSchema,type EvolutionJob,type EvolutionWorkflowRunInput} from "@evolution/contracts";

const isLab=()=>process.env.EVOLUTION_EXPERIMENT_MODE==="isolated";
const armed=()=>process.env.EVOLUTION_LAB_EXPERIMENT_ARMED==="true";
export const LAB_MAX_DURATION_MS=20*60*1000;
export const LAB_MAX_PHYSICAL_CALLS=6;

export class LabWorkflowAdmissionError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name="LabWorkflowAdmissionError";}
}
const deny=(code:string,message:string):never=>{throw new LabWorkflowAdmissionError(code,message);};

/** Only an explicitly approved exact synthetic Mission can be armed in the isolated Lab. */
export function assertLabMissionArmed(missionId:string){
  if(!isLab())return deny("LAB_EXPERIMENT_MODE_REQUIRED","真实 Lab Mission 必须绑定隔离实验模式。");
  if(!armed()||!process.env.EVOLUTION_LAB_APPROVED_MISSION_ID
    ||process.env.EVOLUTION_LAB_APPROVED_MISSION_ID!==missionId){
    return deny("LAB_MISSION_NOT_APPROVED","Lab 未明确开放此唯一合成 Mission。");
  }
}

export function createLabWorkflowPermit(missionId:string,actorId:string,at:string){
  assertLabMissionArmed(missionId);
  const approvedAt=Date.parse(at);
  if(!Number.isFinite(approvedAt)||Math.abs(Date.now()-approvedAt)>60_000){
    return deny("LAB_EXPERIMENT_CLOCK_INVALID","Lab 审批时间无效。");
  }
  return LabWorkflowPermitSchema.parse({
    schemaVersion:"lab-synthetic-experiment-v2",missionId,approvedActorId:actorId,approvedAt:at,
    deadlineAt:new Date(approvedAt+LAB_MAX_DURATION_MS).toISOString(),maxCalls:LAB_MAX_PHYSICAL_CALLS,maxTokens:300_000,
  });
}

/** Verify the immutable Run/Job identity separately from the mutable arm and clock.
 * Cleanup after timeout/disarm must be able to authenticate the original permit.
 */
export function assertLabWorkflowPermitIdentity(input:EvolutionWorkflowRunInput,job?:EvolutionJob,nowMs=Date.now()){
  if(!isLab()){
    if(input.labExperiment)return deny("LAB_EXPERIMENT_PRODUCTION_FORBIDDEN","禁止在非 Lab 环境执行隔离实验授权。");
    return undefined;
  }
  const candidate=LabWorkflowPermitSchema.safeParse(input.labExperiment);
  if(!candidate.success)return deny("LAB_EXPERIMENT_PERMIT_REQUIRED","Lab 工作流缺少服务端签发的实验授权。");
  const permit=candidate.data;
  if(permit.missionId!==input.missionId||input.scheduledFor
    ||Date.parse(permit.approvedAt)!==Date.parse(input.requestedAt)
    ||Date.parse(permit.deadlineAt)-Date.parse(permit.approvedAt)!==LAB_MAX_DURATION_MS
    ||nowMs<Date.parse(permit.approvedAt)-60_000){
    return deny("LAB_EXPERIMENT_PERMIT_MISMATCH","Lab 控制 Job 的身份、审批时间或上限不一致。");
  }
  if(job){
    const stored=LabWorkflowPermitSchema.safeParse(job.metadata?.labExperiment);
    if(!stored.success||job.id!==input.controlJobId||job.missionId!==input.missionId
      ||job.type!=="campaign"||job.generation!==1
      ||JSON.stringify(stored.data)!==JSON.stringify(permit)){
      return deny("LAB_EXPERIMENT_JOB_NOT_BOUND","Lab 运行授权未与数据库中的控制 Job 持久绑定。");
    }
  }
  return permit;
}
export const labMissionStillArmed=(missionId:string)=>isLab()&&armed()
  &&Boolean(process.env.EVOLUTION_LAB_APPROVED_MISSION_ID)
  &&process.env.EVOLUTION_LAB_APPROVED_MISSION_ID===missionId;

/** Read/write paths must additionally verify that approval is still armed and unexpired. */
export function assertLabWorkflowPermit(input:EvolutionWorkflowRunInput,job?:EvolutionJob,nowMs=Date.now()){
  const permit=assertLabWorkflowPermitIdentity(input,job,nowMs);
  if(!permit)return undefined;
  assertLabMissionArmed(input.missionId);
  if(nowMs>=Date.parse(permit.deadlineAt)){
    return deny("LAB_EXPERIMENT_DEADLINE_EXPIRED","Lab 20 分钟截止时间已到，禁止继续执行。");
  }
  return permit;
}

export function isLabPermitJob(job:EvolutionJob){
  return isLab()&&LabWorkflowPermitSchema.safeParse(job.metadata?.labExperiment).success;
}