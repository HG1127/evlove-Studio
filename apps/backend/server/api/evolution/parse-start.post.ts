import {randomUUID} from "node:crypto";
import {createError,defineEventHandler,readMultipartFormData} from "nitro/h3";
import {start} from "workflow/api";
import {
  ArtifactRoleSchema,
  EvolutionJobSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  SourceParseStartResponseSchema,
  SourceParseWorkflowInputSchema,
} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {
  bindServerJobWorkflowRun,
  getServerJobByIdempotencyKey,
  getServerProductionRuntime,
  isBenignJobBookkeepingConflict,
  JobStateConflictError,
} from "../../../src/services/production-runtime";
import {serverSupabaseConfigured} from "../../../src/server-env";
import {sourceParseWorkflow} from "../../../../../workflows/source-parse";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {cancelWorkflowRunById} from "../../../src/services/workflow-run-control";
import {sourceParseIdempotencyIdentity} from "../../../src/services/source-parse-identity";

const MAX_FILE_BYTES=25*1024*1024;

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  if(!serverSupabaseConfigured()){
    throw createError({statusCode:503,statusMessage:"Server Parse 数据面未配置",data:{code:"SERVER_PARSE_UNAVAILABLE"}});
  }
  const parts=await readMultipartFormData(event);
  const file=parts?.find((part)=>part.name==="file"&&part.filename);
  if(!file)throw createError({statusCode:400,statusMessage:"缺少 file"});
  const fileName=file.filename;
  if(!fileName)throw createError({statusCode:400,statusMessage:"上传文件缺少 filename"});
  if(file.data.byteLength>MAX_FILE_BYTES)throw createError({statusCode:413,statusMessage:"单文件不能超过 25MB"});
  const rolePart=parts?.find((part)=>part.name==="role");
  const role=ArtifactRoleSchema.catch("target").parse(rolePart?new TextDecoder().decode(rolePart.data):"target");
  const sessionPart=parts?.find((part)=>part.name==="sessionId");
  const sessionId=(sessionPart?new TextDecoder().decode(sessionPart.data):"").trim()||undefined;
  const artifactIdPart=parts?.find((part)=>part.name==="artifactId");
  const artifactId=(artifactIdPart?new TextDecoder().decode(artifactIdPart.data):"").trim()||`artifact-${randomUUID()}`;
  const lastModifiedPart=parts?.find((part)=>part.name==="lastModified");
  const lastModified=Number(lastModifiedPart?new TextDecoder().decode(lastModifiedPart.data):0)||Date.now();
  const mimeType=file.type||"application/octet-stream";
  const bytes=Uint8Array.from(file.data);
  const {idempotencyKey,contentSha256}=sourceParseIdempotencyIdentity({
    artifactId,
    name:fileName,
    mimeType,
    role,
    bytes,
  });
  const inputRef=artifactId;
  const requestedAt=new Date().toISOString();
  const runtime=getServerProductionRuntime();
  const artifacts=getServerArtifactStore();
  const existing=await getServerJobByIdempotencyKey(idempotencyKey);
  if(existing&&existing.type!=="parse"){
    throw createError({statusCode:409,statusMessage:"Parse idempotency key belongs to another Job type"});
  }
  if(existing&&["queued","running","waiting"].includes(existing.status)){
    return SourceParseStartResponseSchema.parse({
      jobId:existing.id,
      runId:typeof existing.metadata?.runId==="string"?existing.metadata.runId:`existing-${existing.id}`,
      artifactId,
      status:existing.status,
      reused:true,
    });
  }
  if(existing?.status==="completed"&&existing.outputRef){
    const output=await artifacts.get(existing.outputRef).catch(()=>undefined);
    if(output){
      return SourceParseStartResponseSchema.parse({
        jobId:existing.id,
        runId:typeof existing.metadata?.runId==="string"?existing.metadata.runId:`completed-${existing.id}`,
        artifactId,
        status:"completed",
        reused:true,
      });
    }
  }
  const jobId=existing?.id??`parse-${randomUUID()}`;
  const outputRef=existing?.outputRef??`parse-result-${jobId}`;
  const input=SourceParseWorkflowInputSchema.parse({
    jobId,inputRef,outputRef,artifactId,name:fileName,
    mimeType,size:file.data.byteLength,role,requestedAt,
  });
  await artifacts.put(inputRef,new Blob([bytes.buffer],{type:input.mimeType}));
  const queuedJob=EvolutionJobSchema.parse({
    schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,id:jobId,type:"parse",status:"queued",
    label:`Parse ${input.name}`,idempotencyKey,
    generation:(existing?.generation??0)+1,attempts:existing?.attempts??0,priority:80,inputRef,outputRef,
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
      if(["queued","running","waiting","completed"].includes(current.status)){
        return SourceParseStartResponseSchema.parse({
          jobId:current.id,
          runId:typeof current.metadata?.runId==="string"?current.metadata.runId:`existing-${current.id}`,
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
    throw error;
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
    await cancelWorkflowRunById(run.runId).catch(()=>undefined);
    throw createError({statusCode:409,statusMessage:"Parse Workflow 已启动，但对应 Job 已不存在"});
  }

  let boundJob;
  try{
    boundJob=await bindServerJobWorkflowRun(jobId,queued.generation,run.runId,"metadata");
  }catch(error){
    await cancelWorkflowRunById(run.runId).catch(()=>undefined);
    if(error instanceof JobStateConflictError){
      throw createError({
        statusCode:409,statusMessage:"Parse Workflow runId 绑定失败，已取消孤儿 Workflow",
        data:{code:error.code,jobId:error.jobId,reason:error.reason,current:error.current,runId:run.runId},
      });
    }
    throw error;
  }

  if(["cancelled","failed","partial"].includes(boundJob.status)){
    await cancelWorkflowRunById(run.runId).catch(()=>undefined);
    throw createError({
      statusCode:409,
      statusMessage:`Parse Job 在 Workflow 启动期间已进入 ${boundJob.status}，已取消刚启动的 Workflow`,
      data:{jobId,boundStatus:boundJob.status,runId:run.runId},
    });
  }

  return SourceParseStartResponseSchema.parse({
    jobId,runId:run.runId,artifactId,status:boundJob.status,
  });
});
