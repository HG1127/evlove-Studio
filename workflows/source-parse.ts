import {FatalError} from "workflow";
import {
  EvolutionJobSchema,
  SourceArtifactSchema,
  SourceParseWorkflowInputSchema,
  type SourceParseWorkflowInput,
} from "@evolution/contracts";
import {getServerArtifactStore} from "../apps/backend/src/services/artifact-runtime";
import {getServerProductionRuntime} from "../apps/backend/src/services/production-runtime";
import {parseServerSource} from "../apps/backend/src/services/server-source-parser";

export async function executeSourceParseStep(input:SourceParseWorkflowInput){
  "use step";
  const runtime=getServerProductionRuntime();
  const artifacts=getServerArtifactStore();
  const job=await runtime.jobs.get(input.jobId);
  if(!job)throw new FatalError(`Parse Job 不存在：${input.jobId}`);
  const startedAt=new Date().toISOString();
  await runtime.jobs.put(EvolutionJobSchema.parse({
    ...job,status:"running",attempts:job.attempts+1,startedAt:job.startedAt??startedAt,heartbeatAt:startedAt,
    progress:{percent:10,detail:"Server Native Parser 正在读取原始 Artifact"},updatedAt:startedAt,error:undefined,
  }));
  try{
    const blob=await artifacts.get(input.inputRef);
    if(!blob)throw new Error(`Parse raw artifact missing: ${input.inputRef}`);
    const parsed=SourceArtifactSchema.parse(await parseServerSource({
      artifactId:input.artifactId,name:input.name,mimeType:input.mimeType,size:input.size,
      role:input.role,blob,storageRef:input.inputRef,
    }));
    const beforeWrite=await runtime.jobs.get(input.jobId);
    if(beforeWrite?.status==="cancelled"){
      await artifacts.delete(input.inputRef).catch(()=>undefined);
      return {jobId:input.jobId,artifactId:parsed.id,outputRef:input.outputRef,status:"cancelled" as const};
    }
    const encoded=new Blob([JSON.stringify(parsed)],{type:"application/json"});
    await artifacts.put(input.outputRef,encoded);
    const finishedAt=new Date().toISOString();
    const current=await runtime.jobs.get(input.jobId);
    if(current)await runtime.jobs.put(EvolutionJobSchema.parse({
      ...current,status:"completed",outputRef:input.outputRef,
      progress:{percent:100,detail:"Server Parse 完成"},heartbeatAt:finishedAt,finishedAt,updatedAt:finishedAt,
    }));
    return {jobId:input.jobId,artifactId:parsed.id,outputRef:input.outputRef,status:"completed" as const};
  }catch(error){
    const finishedAt=new Date().toISOString();
    const message=error instanceof Error?error.message:String(error);
    const current=await runtime.jobs.get(input.jobId);
    if(current)await runtime.jobs.put(EvolutionJobSchema.parse({
      ...current,status:"failed",error:message,progress:{percent:100,detail:"Server Parse 失败"},
      heartbeatAt:finishedAt,finishedAt,updatedAt:finishedAt,
    }));
    throw new FatalError(message);
  }
}

export async function sourceParseWorkflow(rawInput:unknown){
  "use workflow";
  const input=SourceParseWorkflowInputSchema.parse(rawInput);
  return executeSourceParseStep(input);
}
