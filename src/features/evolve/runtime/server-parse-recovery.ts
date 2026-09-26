import {
  SourceParseJobInputIdentitySchema,
  type EvolutionJob,
  type SourceParseStatusResponse,
} from "@evolution/contracts";
import { getArtifactBlob } from "./artifact-blob-store";

export function recoveredParseState(record:SourceParseStatusResponse){
  const ready=record.job.status==="completed"&&Boolean(record.artifact);
  const temporary=record.resultIssueCode==="temporary-storage-unavailable";
  const terminal=record.job.status==="failed"||record.job.status==="cancelled";
  return {
    status:ready?"ready" as const:terminal||(record.resultIssue&&!temporary)?"error" as const:"parsing" as const,
    resume:!ready&&!terminal&&(!record.resultIssue||temporary),
  };
}

export async function loadRecoveredParseSource(
  job:EvolutionJob,
  readBlob:typeof getArtifactBlob=getArtifactBlob,
):Promise<File>{
  const identity=SourceParseJobInputIdentitySchema.safeParse({
    ...job.metadata,inputRef:job.inputRef,outputRef:job.outputRef,
  });
  if(!identity.success)throw new Error("Parse 原始文件身份无法验证，请重新上传文件");
  const source=identity.data;
  const blob=await readBlob(source.inputRef,{preferRemote:true});
  if(!blob)throw new Error("Parse 原始文件不可读取，请重新上传文件");
  if(blob.size!==source.size)throw new Error("Parse 原始文件大小不一致，请重新上传文件");
  const bytes=await blob.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");
  if(sha256!==source.contentSha256)throw new Error("Parse 原始文件内容不一致，请重新上传文件");
  const lastModified=typeof job.metadata?.lastModified==="number"?job.metadata.lastModified:Date.now();
  return new File([bytes],source.name,{type:source.mimeType,lastModified});
}
