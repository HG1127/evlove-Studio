import {randomUUID} from "node:crypto";
import {assertBodySize,createError,defineEventHandler,readMultipartFormData} from "nitro/h3";
import {start} from "workflow/api";
import {
  EvolutionJobSchema,
  type EvolutionJob,
  PRODUCTION_SCHEMA_VERSIONS,
  SourceParseJobInputIdentitySchema,
  SourceParseStartResponseSchema,
  SourceParseUploadMetadataSchema,
  SourceParseWorkflowInputV2Schema,
  type SourceParseWorkflowInputV2,
} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {
  bindServerJobWorkflowRun,
  getServerJobByIdempotencyKey,
  getServerProductionRuntime,
  isBenignJobBookkeepingConflict,
  JobStateConflictError,
} from "../../../src/services/production-runtime";
import {serverSupabaseSecureConfigured} from "../../../src/server-env";
import {sourceParseWorkflow} from "../../../../../workflows/source-parse";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {cancelWorkflowRunById} from "../../../src/services/workflow-run-control";
import {sourceParseIdempotencyIdentity} from "../../../src/services/source-parse-identity";
import {readSourceParseResult} from "../../../src/services/source-parse-result";

async function cleanupStartedParseRun(runId:string){
  try{return await cancelWorkflowRunById(runId);}
  catch{
    throw createError({statusCode:503,statusMessage:"Parse Workflow 已启动但取消未确认，请按 runId 检查",data:{runId}});
  }
}

function persistedParseRunId(job:EvolutionJob):string|undefined{
  const value=job.metadata?.runId;
  return typeof value==="string"&&value.trim()?value.trim():undefined;
}

function matchesUnboundParseJob(job:EvolutionJob|undefined,input:SourceParseWorkflowInputV2,idempotencyKey:string){
  if(!job||job.id!==input.jobId||job.type!=="parse"||job.status!=="queued"
    ||job.idempotencyKey!==idempotencyKey||job.generation!==input.generation
    ||persistedParseRunId(job))return false;
  const identity=SourceParseJobInputIdentitySchema.safeParse({
    ...job.metadata,inputRef:job.inputRef,outputRef:job.outputRef,
  });
  if(!identity.success)return false;
  const bound=identity.data;
  return bound.inputRef===input.inputRef&&bound.outputRef===input.outputRef
    &&bound.artifactId===input.artifactId&&bound.name===input.name
    &&bound.mimeType===input.mimeType&&bound.size===input.size
    &&bound.role===input.role&&bound.contentSha256===input.contentSha256;
}

const MAX_FILE_BYTES=25*1024*1024;
const MAX_MULTIPART_BYTES=MAX_FILE_BYTES+64*1024;

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  if(!serverSupabaseSecureConfigured()){
    throw createError({statusCode:503,statusMessage:"Server Parse 数据面未配置",data:{code:"SERVER_PARSE_UNAVAILABLE"}});
  }
  assertBodySize(event,MAX_MULTIPART_BYTES);
  const parts=await readMultipartFormData(event);
  const file=parts?.find((part)=>part.name==="file"&&part.filename);
  if(!file)throw createError({statusCode:400,statusMessage:"缺少 file"});
  if(file.data.byteLength>MAX_FILE_BYTES)throw createError({statusCode:413,statusMessage:"单文件不能超过 25MB"});
  const rolePart=parts?.find((part)=>part.name==="role");
  const sessionPart=parts?.find((part)=>part.name==="sessionId");
  const artifactIdPart=parts?.find((part)=>part.name==="artifactId");
  const lastModifiedPart=parts?.find((part)=>part.name==="lastModified");
  const metadata=SourceParseUploadMetadataSchema.safeParse({
    name:file.filename,
    mimeType:file.type||"application/octet-stream",
    role:rolePart?new TextDecoder().decode(rolePart.data):"target",
    sessionId:(sessionPart?new TextDecoder().decode(sessionPart.data):"").trim()||undefined,
    artifactId:(artifactIdPart?new TextDecoder().decode(artifactIdPart.data):"").trim()||`artifact-${randomUUID()}`,
    lastModified:lastModifiedPart?Number(new TextDecoder().decode(lastModifiedPart.data)):Date.now(),
  });
  if(!metadata.success){
    throw createError({statusCode:400,statusMessage:"Invalid Parse upload metadata",data:metadata.error.flatten()});
  }
  const {name:fileName,mimeType,role,sessionId,artifactId,lastModified}=metadata.data;
  const bytes=Uint8Array.from(file.data);
  const {idempotencyKey,contentSha256}=sourceParseIdempotencyIdentity({
    artifactId,
    name:fileName,
    mimeType,
    role,
    bytes,
  });
  const requestedAt=new Date().toISOString();
  const runtime=getServerProductionRuntime();
  const artifacts=getServerArtifactStore();
  const existing=await getServerJobByIdempotencyKey(idempotencyKey);
  if(existing&&existing.type!=="parse"){
    throw createError({statusCode:409,statusMessage:"Parse idempotency key belongs to another Job type"});
  }
  if(existing&&["queued","running","waiting"].includes(existing.status)){
    const runId=persistedParseRunId(existing);
    if(!runId)throw createError({statusCode:409,statusMessage:"Parse Job 尚无已绑定的 Workflow runId，请按 Job ID 检查或稍后重试",data:{jobId:existing.id,generation:existing.generation}});
    return SourceParseStartResponseSchema.parse({
      jobId:existing.id,
      runId,
      artifactId,
      status:existing.status,
      reused:true,
    });
  }
  if(existing?.status==="completed"&&existing.outputRef){
    const output=await readSourceParseResult(existing,artifacts);
    if(output.artifact){
      return SourceParseStartResponseSchema.parse({
        jobId:existing.id,
        runId:persistedParseRunId(existing),
        artifactId,
        status:"completed",
        reused:true,
      });
    }
    if(output.resultIssueCode==="temporary-storage-unavailable"){
      throw createError({statusCode:503,statusMessage:"Parse 结果暂时不可读取，请按 Job ID 重试",data:{code:"PARSE_RESULT_TEMPORARILY_UNAVAILABLE",jobId:existing.id,generation:existing.generation}});
    }
  }
  const jobId=existing?.id??`parse-${randomUUID()}`;
  const generation=(existing?.generation??0)+1;
  const inputRef=`parse-input-${jobId}-g${generation}`;
  const outputRef=`parse-result-${jobId}-g${generation}`;
  const input=SourceParseWorkflowInputV2Schema.parse({
    schemaVersion:"source-parse-workflow-v2",generation,contentSha256,
    jobId,inputRef,outputRef,artifactId,name:fileName,
    mimeType,size:file.data.byteLength,role,requestedAt,
  });
  await artifacts.put(inputRef,new Blob([bytes.buffer],{type:input.mimeType}));
  const queuedJob=EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,id:jobId,type:"parse",status:"queued",
    label:`Parse ${input.name}`,idempotencyKey,
    generation,attempts:existing?.attempts??0,priority:80,inputRef,outputRef,
    metadata:{
      artifactId,
      name:input.name,
      mimeType:input.mimeType,
      size:input.size,
      role,
      sessionId,
      lastModified,
      contentSha256,
      identityVersion:"parse-v2",
    },
    progress:{percent:0,detail:"等待 Durable Parse Workflow"},createdAt:requestedAt,updatedAt:requestedAt,
  });
  try{
    await runtime.jobs.put(queuedJob);
  }catch(error){
    if(error instanceof JobStateConflictError&&error.reason==="idempotency-conflict"&&error.current?.idempotencyKey===idempotencyKey){
      const current=error.current;
      // A newly generated Job ID gives this losing request its own input Artifact.
      // Retries of an existing Job can share a generation input with the winner.
      if(!existing&&current.id!==jobId){
        try{await artifacts.delete(inputRef);}
        catch{
          throw createError({statusCode:409,statusMessage:"并发 Parse 输入清理未确认，请按 Job ID 检查后重试",data:{jobId:current.id,inputRef}});
        }
      }
      if(current.type!=="parse"){
        throw createError({statusCode:409,statusMessage:"Parse idempotency key belongs to another Job type",data:{jobId:current.id}});
      }
      if(["queued","running","waiting","completed"].includes(current.status)){
        const runId=persistedParseRunId(current);
        if(current.status!=="completed"&&!runId)throw createError({statusCode:409,statusMessage:"Parse Job 尚无已绑定的 Workflow runId，请按 Job ID 检查或稍后重试",data:{jobId:current.id,generation:current.generation}});
        if(current.status==="completed"){
          const output=await readSourceParseResult(current,artifacts);
          if(!output.artifact){
            const unavailable=output.resultIssueCode==="temporary-storage-unavailable";
            throw createError({statusCode:unavailable?503:409,statusMessage:unavailable?"Parse 结果暂时不可读取，请按 Job ID 重试":"并发 Parse Job 的完成结果无法验证，请按 Job ID 检查",data:{code:unavailable?"PARSE_RESULT_TEMPORARILY_UNAVAILABLE":undefined,jobId:current.id,generation:current.generation,resultIssue:output.resultIssue}});
          }
        }
        return SourceParseStartResponseSchema.parse({
          jobId:current.id,
          runId,
          artifactId,
          status:current.status,
          reused:true,
        });
      }
      throw createError({
        statusCode:409,
        statusMessage:"同一 Parse 请求已有终态记录，请刷新后重试",
        data:{code:error.code,jobId:current.id,status:current.status,generation:current.generation},
      });
    }
    if(error instanceof JobStateConflictError){
      throw createError({statusCode:409,statusMessage:"Parse Job 写入被当前状态拒绝，请按 Job ID 检查",data:{code:error.code,jobId:error.jobId,reason:error.reason,current:error.current}});
    }
    let committed:EvolutionJob|undefined;
    try{committed=await runtime.jobs.get(jobId);}
    catch{
      throw createError({statusCode:503,statusMessage:"Parse Job 写入结果无法读取，请按 Job ID 检查后重试",data:{code:"PARSE_JOB_WRITE_UNCONFIRMED",jobId,generation,inputRef}});
    }
    if(!matchesUnboundParseJob(committed,input,idempotencyKey)){
      throw createError({statusCode:503,statusMessage:"Parse Job 写入结果未确认，已保留原始文件供恢复",data:{code:"PARSE_JOB_WRITE_UNCONFIRMED",jobId,generation,inputRef}});
    }
    // The write may have committed before its response was lost. This request has not
    // started a Workflow yet, so the exact unbound Job can continue below.
  }
  let run;
  try{
    run=await start(sourceParseWorkflow,[input]);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const current=await runtime.jobs.get(jobId);
    if(current){
      const finishedAt=new Date().toISOString();
      await runtime.jobs.put(EvolutionJobSchema.parse({
        ...current,status:"failed",error:message,finishedAt,updatedAt:finishedAt,
      })).catch((writeError)=>{
        if(!isBenignJobBookkeepingConflict(writeError,current.generation))throw writeError;
      });
    }
    throw createError({statusCode:500,statusMessage:"Parse Workflow 启动失败",data:{message}});
  }

  const queued=await runtime.jobs.get(jobId);
  if(!queued){
    const cleanup=await cleanupStartedParseRun(run.runId);
    throw createError({statusCode:409,statusMessage:"Parse Workflow 已启动，但对应 Job 已不存在；请核对清理结果",data:{runId:run.runId,cleanup}});
  }

  let boundJob;
  try{
    boundJob=await bindServerJobWorkflowRun(jobId,queued.generation,run.runId,"metadata");
  }catch(error){
    const cleanup=await cleanupStartedParseRun(run.runId);
    if(error instanceof JobStateConflictError){
      throw createError({
        statusCode:409,statusMessage:"Parse Workflow runId 绑定失败，请核对清理结果",
        data:{code:error.code,jobId:error.jobId,reason:error.reason,current:error.current,runId:run.runId,cleanup},
      });
    }
    throw error;
  }

  if(["cancelled","failed","partial"].includes(boundJob.status)){
    const cleanup=await cleanupStartedParseRun(run.runId);
    throw createError({
      statusCode:409,
      statusMessage:`Parse Job 在 Workflow 启动期间已进入 ${boundJob.status}，请核对清理结果`,
      data:{jobId,boundStatus:boundJob.status,runId:run.runId,cleanup},
    });
  }

  return SourceParseStartResponseSchema.parse({
    jobId,runId:run.runId,artifactId,status:boundJob.status,
  });
});
