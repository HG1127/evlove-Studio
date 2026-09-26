import {FatalError} from "workflow";
import {createHash} from "node:crypto";
import {
  EvolutionJobSchema,
  SourceParseJobInputIdentitySchema,
  SourceParseResultArtifactSchema,
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
class RetryableParsePersistenceError extends Error{}

async function readPersistedParseOutput(input:SourceParseWorkflowAnyInput,blob:Blob){
  const serialized=await blob.text();
  const artifact=SourceParseResultArtifactSchema.parse(JSON.parse(serialized));
  if(artifact.id!==input.artifactId||artifact.name!==input.name
    ||artifact.mimeType!==input.mimeType||artifact.size!==input.size
    ||artifact.role!==input.role||artifact.storageRef!==input.inputRef){
    throw new Error("Parse result Artifact does not match its Workflow input");
  }
  return {artifact,resultSha256:createHash("sha256").update(serialized).digest("hex")};
}

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
    let existing:Blob|undefined;
    try{existing=await artifacts.get(input.outputRef);}
    catch{throw new RetryableParsePersistenceError("Parse result Artifact read could not be confirmed");}
    let parsed;
    let resultSha256:string;
    if(existing){
      ({artifact:parsed,resultSha256}=await readPersistedParseOutput(input,existing));
      if(artifacts.getMetadata){
        let metadata;
        try{metadata=await artifacts.getMetadata(input.outputRef);}
        catch{throw new RetryableParsePersistenceError("Parse result Artifact metadata could not be confirmed");}
        if(!metadata||metadata.sha256!==resultSha256||metadata.sizeBytes!==existing.size
          ||metadata.mimeType!=="application/json"
          ||(metadata.jobId&&metadata.jobId!==input.jobId)){
          throw new Error("Parse result Artifact metadata does not match its stored bytes");
        }
      }
    }else{
      parsed=SourceParseResultArtifactSchema.parse(await parseServerSource({
        artifactId:input.artifactId,name:input.name,mimeType:input.mimeType,size:input.size,
        role:input.role,blob,storageRef:input.inputRef,
      }));
      if(parsed.id!==input.artifactId||parsed.name!==input.name
        ||parsed.mimeType!==input.mimeType||parsed.size!==input.size
        ||parsed.role!==input.role||parsed.storageRef!==input.inputRef){
        throw new Error("Parse result Artifact does not match its Workflow input");
      }
      let beforeWrite:EvolutionJob|undefined;
      try{beforeWrite=await runtime.jobs.get(input.jobId);}
      catch{throw new RetryableParsePersistenceError("Parse Job binding could not be confirmed before upload");}
      if(!matchesParseJob(input,beforeWrite))throw new StaleParseRunError();
      if(beforeWrite?.status==="cancelled")return cancelledResult();
      const serialized=JSON.stringify(parsed);
      resultSha256=createHash("sha256").update(serialized).digest("hex");
      const encoded=new Blob([serialized],{type:"application/json"});
      try{await artifacts.put(input.outputRef,encoded,{jobId:input.jobId,kind:"source-parse-result"});}
      catch{throw new RetryableParsePersistenceError("Parse result Artifact write could not be confirmed");}
    }
    const finishedAt=new Date().toISOString();
    let current:EvolutionJob|undefined;
    try{current=await runtime.jobs.get(input.jobId);}
    catch{throw new RetryableParsePersistenceError("Parse Job binding could not be confirmed after upload");}
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
        if(error instanceof JobStateConflictError&&error.current?.status==="completed"){
          if(matchesParseJob(input,error.current)
            &&error.current.metadata?.resultSha256===resultSha256){
            return {jobId:input.jobId,artifactId:parsed.id,outputRef:input.outputRef,status:"completed" as const};
          }
          throw new FatalError("Parse completed Job result binding mismatch");
        }
        const settled=await runtime.jobs.get(input.jobId).catch(()=>undefined);
        if(settled?.status==="completed"&&matchesParseJob(input,settled)
          &&settled.metadata?.resultSha256===resultSha256){
          return {jobId:input.jobId,artifactId:parsed.id,outputRef:input.outputRef,status:"completed" as const};
        }
        if(settled?.status==="cancelled"&&matchesParseJob(input,settled))return cancelledResult();
        throw new RetryableParsePersistenceError("Parse Job completion could not be confirmed");
      }
    }
    return {jobId:input.jobId,artifactId:parsed.id,outputRef:input.outputRef,status:"completed" as const};
  }catch(error){
    if(error instanceof RetryableParsePersistenceError||error instanceof FatalError)throw error;
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
