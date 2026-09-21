import {
  GitTargetActionResponseSchema,
  GitTargetCapabilitiesSchema,
  type GitTargetActionRequest,
  type GitTargetActionResponse,
  type GitTargetCapabilities,
} from "@evolution/contracts";

async function apiJson(path:string,init?:RequestInit){
  const response=await fetch(path,init);
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String(
      (body as {statusMessage?:string;message?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Git Target API HTTP ${response.status}`,
    );
    throw new Error(message);
  }
  return body;
}

export async function getServerGitTargetCapabilities():Promise<GitTargetCapabilities>{
  return GitTargetCapabilitiesSchema.parse(await apiJson("/api/evolution/git-capabilities"));
}

export async function runServerGitTargetAction(input:GitTargetActionRequest):Promise<GitTargetActionResponse>{
  return GitTargetActionResponseSchema.parse(await apiJson("/api/evolution/git-action",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(input),
  }));
}
