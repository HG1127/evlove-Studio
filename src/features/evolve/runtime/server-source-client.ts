import {httpApiErrorDetail} from "@evolution/adapters";
import {
  SourceParseCapabilitiesSchema,
  SourceParseCancelResponseSchema,
  SourceParseListResponseSchema,
  SourceParseRecoveryMetadataSchema,
  SourceParseResultPendingErrorDataSchema,
  SourceParseStartResponseSchema,
  SourceParseStatusResponseSchema,
  SourceParseWriteUnconfirmedErrorDataSchema,
  type EvolutionJob,
  type ArtifactRole,
  type SourceArtifact,
  type SourceParseStatusResponse,
} from "@evolution/contracts";

export class ServerParseUnavailableError extends Error{
  code="SERVER_PARSE_UNAVAILABLE" as const;
}

class ServerParseResultPendingError extends Error{
  readonly jobId:string;
  constructor(message:string,jobId:string){super(message);this.jobId=jobId;}
}

async function json(path:string,init?:RequestInit,timeoutMs=15_000){
  const deadline=AbortSignal.timeout(timeoutMs);
  const signal=init?.signal?AbortSignal.any([init.signal,deadline]):deadline;
  let response:Response;
  try{response=await fetch(path,{...init,signal});}
  catch(error){
    if(init?.signal?.aborted)throw init.signal.reason??error;
    if(deadline.aborted)throw new Error("解析服务响应超时，请重试；已保存的原文件和解析任务会保留。",{cause:error});
    throw error;
  }
  let body:unknown;
  try{body=await response.json();}
  catch(error){
    if(init?.signal?.aborted)throw init.signal.reason??error;
    if(deadline.aborted)throw new Error("解析服务响应超时，请重试；已保存的原文件和解析任务会保留。",{cause:error});
    if(response.ok)throw new Error("解析服务返回了无法读取的结果，请重试查看任务状态。",{cause:error});
    body={};
  }
  if(!response.ok){
    const message=httpApiErrorDetail(body)??`Parse API HTTP ${response.status}`;
    if(response.status===503){
      const pending=SourceParseResultPendingErrorDataSchema.safeParse((body as {data?:unknown}).data);
      if(pending.success)throw new ServerParseResultPendingError(message,pending.data.jobId);
      const unconfirmed=SourceParseWriteUnconfirmedErrorDataSchema.safeParse((body as {data?:unknown}).data);
      if(unconfirmed.success)throw new Error(`${message}（Job ${unconfirmed.data.jobId}）`);
    }
    if([401,403,404,503].includes(response.status))throw new ServerParseUnavailableError(message);
    throw new Error(message);
  }
  return body;
}

export function canFallbackToLocalParse(error:unknown,serverJobId?:string):error is ServerParseUnavailableError{
  // Never substitute browser-local bytes once a durable Job ID has been acknowledged.
  return error instanceof ServerParseUnavailableError&&!serverJobId;
}

/** A completed but permanently unreadable result may be safely retried as a new generation. */
export function parseNeedsNewGeneration(status:SourceParseStatusResponse){
  return status.job.status==="failed"||status.job.status==="cancelled"
    ||(status.job.status==="completed"&&!status.artifact&&status.resultIssueCode!=="temporary-storage-unavailable");
}

export async function getServerParseCapabilities(){
  return SourceParseCapabilitiesSchema.parse(await json("/api/evolution/parse-capabilities"));
}

export async function startServerParseFile(file:File,role:ArtifactRole,artifactId:string,sessionId?:string,signal?:AbortSignal){
  const form=new FormData();
  form.append("file",file);
  form.append("role",role);
  form.append("artifactId",artifactId);
  form.append("lastModified",String(file.lastModified));
  if(sessionId)form.append("sessionId",sessionId);
  try{
    const receipt=SourceParseStartResponseSchema.parse(await json("/api/evolution/parse-start",{method:"POST",body:form,signal},90_000));
    if(receipt.artifactId!==artifactId)throw new Error("Parse start Artifact identity mismatch");
    return receipt;
  }catch(error){
    if(error instanceof ServerParseResultPendingError){
      return SourceParseStartResponseSchema.parse({jobId:error.jobId,artifactId,status:"completed",reused:true});
    }
    throw error;
  }
}

export async function getServerParseStatus(jobId:string,signal?:AbortSignal){
  const status=SourceParseStatusResponseSchema.parse(await json("/api/evolution/parse-status?id="+encodeURIComponent(jobId),{signal}));
  if(status.job.id!==jobId||status.job.type!=="parse")throw new Error("Parse status Job identity mismatch");
  if(status.artifact&&typeof status.job.metadata?.artifactId==="string"
    &&status.artifact.id!==status.job.metadata.artifactId)throw new Error("Parse status Artifact identity mismatch");
  return status;
}

export async function waitForServerParseJob(jobId:string,signal?:AbortSignal,expectedArtifactId?:string,onStatus?:(status:SourceParseStatusResponse)=>void){
  const deadline=AbortSignal.timeout(5*60_000);
  const combined=signal?AbortSignal.any([signal,deadline]):deadline;
  try{
    for(;;){
      combined.throwIfAborted();
      const status=await getServerParseStatus(jobId,combined);
      onStatus?.(status);
      if(status.job.status==="completed"&&status.artifact){
        if(expectedArtifactId&&status.artifact.id!==expectedArtifactId)throw new Error("Parse result Artifact identity mismatch");
        return status.artifact;
      }
      if(status.job.status==="completed"&&status.resultIssueCode!=="temporary-storage-unavailable")throw new Error(status.resultIssue??"Parse 结果 Artifact 缺失");
      if(status.job.status==="failed"||status.job.status==="cancelled")throw new Error(status.job.error??"Server Parse 失败");
      await new Promise<void>((resolve,reject)=>{
        const finish=()=>{combined.removeEventListener("abort",abort);resolve();};
        const abort=()=>{clearTimeout(timer);combined.removeEventListener("abort",abort);reject(combined.reason);};
        const timer=setTimeout(finish,350);
        combined.addEventListener("abort",abort,{once:true});
        if(combined.aborted)abort();
      });
    }
  }catch(error){
    if(signal?.aborted)throw signal.reason??error;
    if(deadline.aborted)throw new Error("解析任务等待超过 5 分钟；原文件和任务已保留，可重试查看状态。",{cause:error});
    throw error;
  }
}

export async function listServerParseJobs(sessionId?:string){
  const suffix=sessionId?"?sessionId="+encodeURIComponent(sessionId):"";
  return SourceParseListResponseSchema.parse(await json("/api/evolution/parse-jobs"+suffix)).items;
}

export async function cancelServerParseJob(jobId:string,deleteArtifact=true){
  const receipt=SourceParseCancelResponseSchema.parse(await json("/api/evolution/parse-cancel",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({jobId,deleteArtifact}),
  }));
  if(receipt.jobId!==jobId)throw new Error("Parse cancel Job identity mismatch");
  return receipt;
}

export function parseJobMetadata(job:EvolutionJob){
  const metadata=job.metadata??{};
  const parsed=SourceParseRecoveryMetadataSchema.safeParse({
    artifactId:metadata.artifactId,
    name:metadata.name,
    mimeType:metadata.mimeType,
    size:metadata.size,
    lastModified:metadata.lastModified,
    role:metadata.role,
  });
  if(!parsed.success)throw new Error(`Parse Job ${job.id} 的恢复元数据无效，请重新上传原文件`);
  return parsed.data;
}

export async function parseServerFile(args:{
  file:File;
  role:ArtifactRole;
  artifactId?:string;
  sessionId?:string;
  signal?:AbortSignal;
}):Promise<SourceArtifact>{
  const artifactId=args.artifactId??`artifact-${crypto.randomUUID()}`;
  const start=await startServerParseFile(args.file,args.role,artifactId,args.sessionId,args.signal);
  return waitForServerParseJob(start.jobId,args.signal,artifactId);
}

export async function ingestSourcesOnServer(args:{
  files?:File[];
  text?:string;
  role?:"target"|"reference"|"eval";
  roles?:ArtifactRole[];
  signal?:AbortSignal;
}):Promise<SourceArtifact[]>{
  const files=args.files??[];
  if(files.length>12)throw new Error("单次最多上传 12 个附件");
  if(files.reduce((sum,file)=>sum+file.size,0)>60*1024*1024)throw new Error("附件总大小不能超过 60MB");
  const requestedRole=args.role??"target";
  const inputs=files.map((file,index)=>({
    file,
    role:(args.roles?.[index]??(index===0?requestedRole:"reference")) as ArtifactRole,
  }));
  const text=args.text?.trim();
  if(text){
    inputs.push({
      file:new File([text],files.length?"补充粘贴内容.txt":"粘贴内容.txt",{type:"text/plain"}),
      role:(files.length?"reference":requestedRole) as ArtifactRole,
    });
  }
  if(!inputs.length)throw new Error("请至少上传一个附件或粘贴一段待进化内容");
  const out:SourceArtifact[]=[];
  for(let index=0;index<inputs.length;index+=3){
    const batch=inputs.slice(index,index+3);
    out.push(...await Promise.all(batch.map((input)=>parseServerFile({...input,signal:args.signal}))));
  }
  return out;
}
