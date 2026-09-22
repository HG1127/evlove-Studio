import {AiOperationSchema,type AiOperation} from "@evolution/contracts";

type ServerAiEnvelope={operation:AiOperation;result:unknown};

export class ServerAiUnavailableError extends Error{
  code="SERVER_AI_UNAVAILABLE" as const;
}

export async function runServerAiOperation<T>(operation:AiOperation,payload:unknown):Promise<T>{
  AiOperationSchema.parse(operation);
  const response=await fetch("/api/evolution/ai",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({operation,payload}),
  });
  const body=await response.json().catch(()=>({})) as Partial<ServerAiEnvelope>&{message?:string;statusMessage?:string;data?:{code?:string}};
  if(!response.ok){
    const authUnavailable=response.status===401||response.status===403;
    const providerUnavailable=response.status===503&&body.data?.code==="SERVER_AI_UNAVAILABLE";
    if(authUnavailable||providerUnavailable){
      throw new ServerAiUnavailableError(body.statusMessage??body.message??`Server AI unavailable: HTTP ${response.status}`);
    }
    throw new Error(body.statusMessage??body.message??`Server AI HTTP ${response.status}`);
  }
  if(body.operation!==operation)throw new Error("Server AI response operation mismatch");
  return body.result as T;
}
