import {
  SandboxTargetBatchRequestSchema,
  SandboxTargetBatchResponseSchema,
  type SandboxTargetBatchRequest,
} from "@evolution/contracts";

export async function runServerSandboxTargetBatch(input:SandboxTargetBatchRequest){
  const payload=SandboxTargetBatchRequestSchema.parse(input);
  const response=await fetch("/api/evolution/sandbox-run",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String((body as {message?:string;statusMessage?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Sandbox Target HTTP ${response.status}`);
    throw new Error(message);
  }
  return SandboxTargetBatchResponseSchema.parse(body);
}
