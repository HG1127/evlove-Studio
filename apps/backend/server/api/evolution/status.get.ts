import { defineEventHandler, getQuery, setResponseStatus } from "nitro/h3";
import { getRun } from "workflow/api";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";

export default defineEventHandler(async(event)=>{
  const query=getQuery(event);
  const runId=typeof query.runId==="string"?query.runId:undefined;
  const jobId=typeof query.jobId==="string"?query.jobId:undefined;
  if(!runId&&!jobId){
    setResponseStatus(event,400);
    return {error:"需要 runId 或 jobId"};
  }

  const runtime=getServerProductionRuntime();
  const job=jobId?await runtime.jobs.get(jobId):undefined;
  let workflow:{exists:boolean;status?:unknown}|undefined;
  if(runId){
    const run=getRun(runId);
    const exists=await run.exists;
    workflow=exists?{exists:true,status:await run.status}:{exists:false};
  }
  const events=job?.missionId?await runtime.events.list(job.missionId,25):[];
  return {workflow,job,events};
});
