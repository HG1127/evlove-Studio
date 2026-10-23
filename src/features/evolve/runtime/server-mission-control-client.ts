import {z} from "zod";
import {
  EvolutionJobSchema,MissionEnvelopeSchema,EvolutionWorkflowStatusResponseSchema,type EvolutionJob,
} from "@evolution/contracts";

export type MissionControlInspection={
  missionId:string;revision:number;stage:string;campaignStatus:string;
  checkpoint?:string;candidateCount:number;acceptedOutputs:number;
  latestJob?:Pick<EvolutionJob,"id"|"status"|"updatedAt"|"error">;
  runId?:string;workflowStatus?:string;
  state:"ready"|"active"|"completed"|"needs-review";
  reason:string;
};

async function getJson(path:string,callerSignal?:AbortSignal){
  // Bound every read and let manual refresh / Mission navigation cancel it.
  // Timeout remains fail-closed, never authorizing a fresh Workflow.
  const timeoutSignal=AbortSignal.timeout(12_000);
  const signal=callerSignal?AbortSignal.any([callerSignal,timeoutSignal]):timeoutSignal;
  let res:Response;
  try{
    res=await fetch(path,{credentials:"same-origin",cache:"no-store",signal});
  }catch(error){
    if(callerSignal?.aborted)throw error;
    if(timeoutSignal.aborted)throw new Error("后端任务状态查询超时（12 秒）；可再次刷新，当前仍禁止重复启动",{cause:error});
    throw error;
  }
  if(!res.ok){
    throw new Error(res.status===401?"请先在此浏览器连接后端工作区"
      :"无法读取后端任务状态（HTTP "+res.status+"）；不得凭本地界面状态重新启动");
  }
  return res.json() as Promise<unknown>;
}

/**
 * Read the authenticated durable system of record before offering a new
 * Campaign start. A stale local "等待启动" is never evidence that a prior
 * Worker/Workflow has terminated.
 *
 * This is deliberately read-only. No confirmation, retry or Job creation.
 */
export async function inspectServerMissionControl(missionId:string,signal?:AbortSignal):Promise<MissionControlInspection>{
  const [rawEnvelope,rawJobs]=await Promise.all([
    getJson("/api/evolution/missions/"+encodeURIComponent(missionId),signal),
    getJson("/api/evolution/jobs?missionId="+encodeURIComponent(missionId),signal),
  ]);
  const envelope=MissionEnvelopeSchema.parse(rawEnvelope);
  if(envelope.missionId!==missionId)throw new Error("后端 Mission 身份不匹配，禁止运行");
  const jobs=z.array(EvolutionJobSchema).parse(rawJobs)
    // Match the backend start guard: every Campaign Job can block a fresh run,
    // including historical/migrated receipts with another idempotency-key format.
    .filter(job=>job.missionId===missionId&&job.type==="campaign")
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id));
  const latest=jobs[0],p=envelope.payload;
  const currentRunId=latest?.outputRef
    ??(typeof latest?.metadata?.runId==="string"?latest.metadata.runId:undefined);
  let workflowStatus:string|undefined;
  let workflowUncertain=false;
  if(currentRunId&&latest){
    try{
      const query=new URLSearchParams({runId:currentRunId,jobId:latest.id});
      const result=EvolutionWorkflowStatusResponseSchema.parse(
        await getJson("/api/evolution/status?"+query.toString(),signal));
      if(result.job&&result.job.missionId!==missionId)throw new Error("Job Mission 身份不匹配");
      workflowStatus=result.workflow?.exists?result.workflow.status:"missing";
    }catch(error){
      if(signal?.aborted)throw error;
      workflowUncertain=true;
    }
  }
  if(workflowUncertain)workflowStatus="unavailable";
  const unfinished=jobs.some(job=>["queued","running","waiting"].includes(job.status));
  const unfinishedWorkflow=workflowStatus==="running"||workflowStatus==="pending";
  const acceptedOutputs=p.outputArtifacts.filter(a=>a.kind==="primary"&&a.accepted).length;
  const campaignStatus=p.campaign.status;
  const terminal=campaignStatus==="completed"&&acceptedOutputs>0;
  const emptyIdle=!latest&&campaignStatus==="idle"&&p.campaign.currentRound===0
    &&p.candidates.length===0&&acceptedOutputs===0;
  let state:MissionControlInspection["state"],reason:string;
  if(unfinished||unfinishedWorkflow){
    state="active";
    reason=workflowUncertain
      ?"后端 Campaign Job 仍未结算，且 Workflow 状态读取超时或失败；禁止再次启动。"
      :"后端存在未结束或待结算的 Campaign Job；禁止再次启动。";
  }else if(terminal&&!workflowUncertain){
    state="completed";
    reason="后端已完成离线成果验收；请查看交付文件，不要重新启动。";
  }else if(emptyIdle){
    state="ready";
    reason="未发现此 Mission 的历史 Campaign Job，可以按受控启动流程运行。";
  }else{
    state="needs-review";
    reason=workflowUncertain?"后端 Workflow 实际状态暂时无法核验，禁止重复启动。"
      :latest&&!currentRunId?"已有历史 Job 但未绑定可核验 Run，需先检查断点。"
      :"后端历史 Job 或 Campaign 状态需要核验后才能安全继续。";
  }
  return {
    missionId,revision:envelope.revision,stage:p.stage,
    campaignStatus,checkpoint:p.campaign.checkpoint?.completedPhase,
    candidateCount:p.candidates.length,acceptedOutputs,
    ...(latest?{latestJob:{id:latest.id,status:latest.status,updatedAt:latest.updatedAt,
      ...(latest.error?{error:latest.error.slice(0,220)}:{})}}:{}),
    ...(currentRunId?{runId:currentRunId}:{}),
    ...(workflowStatus?{workflowStatus}:{}),
    state,reason,
  };
}
