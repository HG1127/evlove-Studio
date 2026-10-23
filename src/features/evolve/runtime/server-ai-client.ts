import {getActiveAbortSignal} from "./abort-scope";
import {httpApiErrorDetail} from "@evolution/adapters";
import {AiOperationSchema,AiResultSchemas,type AiOperation} from "@evolution/contracts";

type ServerAiEnvelope={operation:AiOperation;result:unknown};

export class ServerAiUnavailableError extends Error{
  code="SERVER_AI_UNAVAILABLE" as const;
}

export async function runServerAiOperation<T>(operation:AiOperation,payload:unknown,options?:{signal?:AbortSignal}):Promise<T>{
  AiOperationSchema.parse(operation);
  const response=await fetch("/api/evolution/ai",{
    method:"POST",
    signal:options?.signal??getActiveAbortSignal()??AbortSignal.timeout(180_000),
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({operation,payload}),
  });
  const body=await response.json().catch(()=>({})) as Partial<ServerAiEnvelope>&{message?:string;statusMessage?:string;data?:{code?:string}};
  if(!response.ok){
    const authUnavailable=response.status===401||response.status===403;
    const providerUnavailable=response.status===503&&body.data?.code==="SERVER_AI_UNAVAILABLE";
    if(authUnavailable||providerUnavailable){
      throw new ServerAiUnavailableError(httpApiErrorDetail(body)??`后端模型暂不可用（HTTP ${response.status}），请重试或检查模型连接。`);
    }
    throw new Error(httpApiErrorDetail(body)??`后端模型请求未完成（HTTP ${response.status}），请重试或查看运行记录。`);
  }
  if(body.operation!==operation)throw new Error("Server AI response operation mismatch");
  return AiResultSchemas[operation].parse(body.result) as T;
}
