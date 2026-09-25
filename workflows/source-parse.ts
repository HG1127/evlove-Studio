import {FatalError} from "workflow";
import {createHash} from "node:crypto";
import {
  EvolutionJobSchema,
  SourceArtifactSchema,
  SourceParseJobInputIdentitySchema,
  SourceParseWorkflowAnyInputSchema,
  type EvolutionJob,
  type SourceParseWorkflowAnyInput,
} from "@evolution/contracts";
import {getServerArtifactStore} from "../apps/backend/src/services/artifact-runtime";
import {
  getServerProductionRuntime,
  JobStateConflictError,
} from "../apps/backend/src/services/production-runtime";
import {parseServerSource} from "../apps/backend/src/services/server-source-parser";

class StaleParseRunError extends Error{}

function matchesParseJob(input:SourceParseWorkflowAnyInput,job:EvolutionJob|undefined){
  if(!job||job.type!=="parse"||job.inputRef!==input.inputRef||job.outputRef!==input.outputRef)return false;
  if(!("schemaVersion" in input))return true;
  if(job.generation!==input.generation)return false;
  const identity=SourceParseJobInputIdentitySchema.safeParse({
    ...job.metadata,inputRef:job.inputRef,outputRef:job.outputRef,
  });
  if(!identity.success)return false;
  const bound=identity.data;
  return bound.artifactId===input.artifactId&&bound.name===input.name
    &&bound.mimeType===input.mimeType&&bound.size===input.size&&bound.role===input.role
    &&bound.contentSha256===input.contentSha256;
}

export async function executeSourceParseStep(input:SourceParseWorkflowAnyInput){
  "use step";
  const runtime=getServerProductionRuntime();
  const artifacts=getServerArtifactStore();
  const job=await runtime.jobs.get(input.jobId);
  if(!job)throw new FatalError(`Parse Job 不存在：${input.jobId}`);
  if(!matchesParseJob(input,job))throw new FatalError("Parse Workflow 与当前 Job 绑定不一致");
  const cancelledResult=async()=>{
    await artifacts.delete(input.outputRef).catch(()=>undefined);
    await artifacts.delete(input.inputRef).catch(()=>undefined);
    return {jobId:input.jobId,artifactId:input.artifactId,outputRef:input.outputRef,status:"cancelled" as const};
  };
  const startedAt=new Date().toISOString();
  try{
    await runtime.jobs.put(EvolutionJobSchema.parse({
      ...job,status:"running",attempts:job.attempts+1,startedAt:job.startedAt??startedAt,heartbeatAt:startedAt,
      progress:{percent:10,detail:"Server Native Parser 正在读取原始 Artifact"},updatedAt:startedAt,error:undefined,
    }));
  }catch(error){
    if(error instanceof JobStateConflictError&&error.current?.status==="cancelled")return cancelledResult();
    if(error instanceof JobStateConflictError&&error.current?.status==="completed"
      &&matchesParseJob(input,error.current)){
      return {
        jobId:input.jobId,artifactId:input.artifactId,
        outputRef:error.current.outputRef??input.outputRef,status:"completed" as const,
      };
    }
    throw error;
  }
  try{
    const blob=await artifacts.get(input.inputRef);
    if(!blob)throw new Error(`Parse raw artifact missing: ${input.inputRef}`);
    if(blob.size!==input.size)throw new Error("Parse source Artifact size mismatch");
    const expectedSha256="schemaVersion" in input
      ?input.contentSha256:job.metadata?.contentSha256;
    if(typeof expectedSha256==="string"){
      const actualSha256=createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex");
      if(actualSha256!==expectedSha256)throw new Error("Parse source Artifact content mismatch");
    }
    const parsed=SourceArtifactSchema.parse(await parseServerSource({
      artifactId:input.artifactId,name:input.name,mimeType:input.mimeType,size:input.size,
      role:input.role,blob,storageRef:input.inputRef,
    }));
    const beforeWrite=await runtime.jobs.get(input.jobId);
    if(!matchesParseJob(input,beforeWrite))throw new StaleParseRunError();
    if(beforeWrite?.status==="cancelled")return cancelledResult();
    const serialized=JSON.stringify(parsed);
    const resultSha256=createHash("sha256").update(serialized).digest("hex");
    const encoded=new Blob([serialized],{type:"application/json"});
    await artifacts.put(input.outputRef,encoded);
    const finishedAt=new Date().toISOString();
    const current=await runtime.jobs.get(input.jobId);
    if(!matchesParseJob(input,current))throw new StaleParseRunError();
    if(current?.status==="cancelled")return cancelledResult();
    if(current){
      try{
        await runtime.jobs.put(EvolutionJobSchema.parse({
          ...current,status:"completed",outputRef:input.outputRef,
          metadata:{...current.metadata,resultSha256},
          progress:{percent:100,detail:"Server Parse 完成"},heartbeatAt:finishedAt,finishedAt,updatedAt:finishedAt,
        }));
      }catch(error){
        if(error instanceof JobStateConflictError&&error.current?.status==="cancelled"
          &&matchesParseJob(input,error.current))return cancelledResult();
        if(!(error instanceof JobStateConflictError&&error.current?.status==="completed"
          &&matchesParseJob(input,error.current)))throw error;
      }
    }
    return {jobId:input.jobId,artifactId:parsed.id,outputRef:input.outputRef,status:"completed" as const};
  }catch(error){
    if(error instanceof StaleParseRunError)throw new FatalError("Parse Workflow generation changed");
    if(error instanceof JobStateConflictError&&error.current?.status==="cancelled"
      &&matchesParseJob(input,error.current))return cancelledResult();
    const finishedAt=new Date().toISOString();
    const message=error instanceof Error?error.message:String(error);
    const current=await runtime.jobs.get(input.jobId);
    if(!matchesParseJob(input,current))throw new FatalError("Parse Workflow generation changed");
    if(current?.status==="cancelled")return cancelledResult();
    if(current)await runtime.jobs.put(EvolutionJobSchema.parse({
      ...current,status:"failed",error:message,progress:{percent:100,detail:"Server Parse 失败"},
      heartbeatAt:finishedAt,finishedAt,updatedAt:finishedAt,
    })).catch((writeError)=>{
      if(!(writeError instanceof JobStateConflictError&&writeError.current?.status==="cancelled"))throw writeError;
    });
    const afterFailure=await runtime.jobs.get(input.jobId).catch(()=>undefined);
    if(afterFailure?.status==="cancelled")return cancelledResult();
    throw new FatalError(message);
  }
}

export async function sourceParseWorkflow(rawInput:unknown){
  "use workflow";
  const input=SourceParseWorkflowAnyInputSchema.parse(rawInput);
  return executeSourceParseStep(input);
}
