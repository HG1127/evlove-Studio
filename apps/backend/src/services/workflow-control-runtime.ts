import {FatalError} from "workflow";
import type {EvolveProject,EvolutionWorkflowRunInput} from "@evolution/contracts";
import {serverControlJobRunId} from "@evolution/harness";
import {getServerMissionEnvelope,getServerProductionRuntime} from "./production-runtime";

/** Read-only ownership checks never refresh the writer's original CAS revision. */
function assertOwner(input:EvolutionWorkflowRunInput,project:EvolveProject|undefined){
  const owner=project?.campaign.serverControlOwner;
  if(!project||(input.controlOwnerKey&&!owner)||owner&&(owner.controlJobId!==input.controlJobId
    ||input.controlOwnerKey&&owner.operationKey!==input.controlOwnerKey)){
    throw new FatalError("已有其他后台控制接管当前 Mission");
  }
  if(owner&&owner.phase!=="bound")throw new Error("后台 Run 绑定尚未完成，请稍后继续");
}

export async function requireServerWorkflowControlOwner(input:EvolutionWorkflowRunInput){
  const runtime=getServerProductionRuntime(),project=await runtime.missions.get(input.missionId);
  assertOwner(input,project);
  const owner=project?.campaign.serverControlOwner;
  if(owner){
    const job=await runtime.jobs.get(owner.controlJobId);
    if(!job||job.generation!==1||job.type!=="campaign"||job.missionId!==input.missionId
      ||job.idempotencyKey!==owner.operationKey||serverControlJobRunId(job,project!)!==owner.runId
      ||["completed","partial","failed","cancelled"].includes(job.status)){
      throw new FatalError("当前控制 Job 与后台预留的 Run 绑定不一致或已结束");
    }
  }
}

export function getServerWorkflowControlRuntime(input:EvolutionWorkflowRunInput){
  const runtime=getServerProductionRuntime();
  return {...runtime,missions:{...runtime.missions,get:async(id:string)=>{
    const project=await runtime.missions.get(id);
    if(project||input.controlOwnerKey)assertOwner(input,project);
    return project;
  },save:async(project:EvolveProject)=>{
    if(project.id!==input.missionId)throw new FatalError("后台控制写入不属于当前 Mission");
    if(input.controlOwnerKey||project.campaign.serverControlOwner){
      assertOwner(input,project);
      assertOwner(input,(await getServerMissionEnvelope(input.missionId))?.payload);
    }
    // The underlying port still CAS-writes the revision from its own earlier read.
    return runtime.missions.save(project);
  }}};
}
