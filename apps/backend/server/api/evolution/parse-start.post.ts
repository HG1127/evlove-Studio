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
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {serverSupabaseConfigured} from "../../../src/server-env";
import {sourceParseWorkflow} from "../../../../../workflows/source-parse";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

const MAX_FILE_BYTES=25*1024*1024;

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"mission.execute");
  if(!serverSupabaseConfigured()){
    throw createError({statusCode:503,statusMessage:"Server Parse 数据面未配置",data:{code:"SERVER_PARSE_UNAVAILABLE"}});
  }
  const parts=await readMultipartFormData(event);
  const file=parts?.find((part)=>part.name==="file"&&part.filename);
  if(!file)throw createError({statusCode:400,statusMessage:"缺少 file"});
  if(file.data.byteLength>MAX_FILE_BYTES)throw createError({statusCode:413,statusMessage:"单文件不能超过 25MB"});
  const rolePart=parts?.find((part)=>part.name==="role");
  const role=ArtifactRoleSchema.catch("target").parse(rolePart?new TextDecoder().decode(rolePart.data):"target");
  const sessionPart=parts?.find((part)=>part.name==="sessionId");
  const sessionId=(sessionPart?new TextDecoder().decode(sessionPart.data):"").trim()||undefined;
  const artifactIdPart=parts?.find((part)=>part.name==="artifactId");
  const artifactId=(artifactIdPart?new TextDecoder().decode(artifactIdPart.data):"").trim()||`artifact-${randomUUID()}`;
  const lastModifiedPart=parts?.find((part)=>part.name==="lastModified");
  const lastModified=Number(lastModifiedPart?new TextDecoder().decode(lastModifiedPart.data):0)||Date.now();
  const idempotencyKey=`parse:${artifactId}:${file.data.byteLength}:${lastModified}`;
  const inputRef=artifactId;
  const requestedAt=new Date().toISOString();
  const runtime=getServerProductionRuntime();
  const artifacts=getServerArtifactStore();
  const existing=(await runtime.jobs.list()).find((job)=>job.type==="parse"&&job.idempotencyKey===idempotencyKey);
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
    jobId,inputRef,outputRef,artifactId,name:file.filename,
    mimeType:file.type||"application/octet-stream",size:file.data.byteLength,role,requestedAt,
  });
  const bytes=Uint8Array.from(file.data);
  await artifacts.put(inputRef,new Blob([bytes.buffer],{type:input.mimeType}));
  await runtime.jobs.put(EvolutionJobSchema.parse({
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
    },
    progress:{percent:0,detail:"等待 Durable Parse Workflow"},createdAt:requestedAt,updatedAt:requestedAt,
  }));
  try{
    const run=await start(sourceParseWorkflow,[input]);
    const queued=await runtime.jobs.get(jobId);
    if(queued)await runtime.jobs.put(EvolutionJobSchema.parse({
      ...queued,
      metadata:{...(queued.metadata??{}),runId:run.runId},
      updatedAt:new Date().toISOString(),
    }));
    return SourceParseStartResponseSchema.parse({jobId,runId:run.runId,artifactId,status:"queued"});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const current=await runtime.jobs.get(jobId);
    if(current)await runtime.jobs.put(EvolutionJobSchema.parse({
      ...current,status:"failed",error:message,finishedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    }));
    throw createError({statusCode:500,statusMessage:"Parse Workflow 启动失败",data:{message}});
  }
});
