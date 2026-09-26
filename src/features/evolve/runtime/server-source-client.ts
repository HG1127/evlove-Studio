import {
  SourceParseCapabilitiesSchema,
  SourceParseCancelResponseSchema,
  SourceParseListResponseSchema,
  SourceParseResultPendingErrorDataSchema,
  SourceParseStartResponseSchema,
  SourceParseStatusResponseSchema,
  SourceParseWriteUnconfirmedErrorDataSchema,
  type EvolutionJob,
  type ArtifactRole,
  type SourceArtifact,
} from "@evolution/contracts";

export class ServerParseUnavailableError extends Error{
  code="SERVER_PARSE_UNAVAILABLE" as const;
}

class ServerParseResultPendingError extends Error{
  readonly jobId:string;
  constructor(message:string,jobId:string){super(message);this.jobId=jobId;}
}

async function json(path:string,init?:RequestInit){
  const response=await fetch(path,init);
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String((body as {statusMessage?:string;message?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Parse API HTTP ${response.status}`);
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

export async function getServerParseCapabilities(){
  return SourceParseCapabilitiesSchema.parse(await json("/api/evolution/parse-capabilities"));
}

export async function startServerParseFile(file:File,role:ArtifactRole,artifactId:string,sessionId?:string){
  const form=new FormData();
  form.append("file",file);
  form.append("role",role);
  form.append("artifactId",artifactId);
  form.append("lastModified",String(file.lastModified));
  if(sessionId)form.append("sessionId",sessionId);
  try{
    return SourceParseStartResponseSchema.parse(await json("/api/evolution/parse-start",{method:"POST",body:form}));
  }catch(error){
    if(error instanceof ServerParseResultPendingError){
      return SourceParseStartResponseSchema.parse({jobId:error.jobId,artifactId,status:"completed",reused:true});
    }
    throw error;
  }
}

export async function getServerParseStatus(jobId:string){
  return SourceParseStatusResponseSchema.parse(await json("/api/evolution/parse-status?id="+encodeURIComponent(jobId)));
}

export async function waitForServerParseJob(jobId:string,signal?:AbortSignal){
  const started=Date.now();
  while(Date.now()-started<5*60_000){
    if(signal?.aborted)throw signal.reason??new DOMException("Aborted","AbortError");
    const status=await getServerParseStatus(jobId);
    if(status.job.status==="completed"&&status.artifact)return status.artifact;
    if(status.job.status==="completed"&&status.resultIssueCode!=="temporary-storage-unavailable"){
      throw new Error(status.resultIssue??"Parse 结果 Artifact 缺失");
    }
    if(status.job.status==="failed"||status.job.status==="cancelled"){
      throw new Error(status.job.error??"Server Parse 失败");
    }
    await new Promise((resolve)=>setTimeout(resolve,350));
  }
  throw new Error("Server Parse 超时：5 分钟内未完成");
}

export async function listServerParseJobs(sessionId?:string){
  const suffix=sessionId?"?sessionId="+encodeURIComponent(sessionId):"";
  return SourceParseListResponseSchema.parse(await json("/api/evolution/parse-jobs"+suffix)).items;
}

export async function cancelServerParseJob(jobId:string,deleteArtifact=true){
  return SourceParseCancelResponseSchema.parse(await json("/api/evolution/parse-cancel",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({jobId,deleteArtifact}),
  }));
}

export function parseJobMetadata(job:EvolutionJob){
  const metadata=job.metadata??{};
  return {
    artifactId:typeof metadata.artifactId==="string"?metadata.artifactId:job.inputRef,
    name:typeof metadata.name==="string"?metadata.name:job.label.replace(/^Parse\s+/,""),
    mimeType:typeof metadata.mimeType==="string"?metadata.mimeType:"application/octet-stream",
    size:typeof metadata.size==="number"?metadata.size:0,
    lastModified:typeof metadata.lastModified==="number"?metadata.lastModified:Date.now(),
    role:(typeof metadata.role==="string"?metadata.role:"target") as ArtifactRole,
  };
}

export async function parseServerFile(args:{
  file:File;
  role:ArtifactRole;
  artifactId?:string;
  sessionId?:string;
  signal?:AbortSignal;
}):Promise<SourceArtifact>{
  const artifactId=args.artifactId??`artifact-${crypto.randomUUID()}`;
  const start=await startServerParseFile(args.file,args.role,artifactId,args.sessionId);
  return waitForServerParseJob(start.jobId,args.signal);
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
