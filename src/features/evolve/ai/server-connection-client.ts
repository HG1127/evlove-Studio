import {
  ServerAiConnectionPutSchema,ServerAiConnectionStatusSchema,ServerAiRuntimeHealthSchema,
  type ServerAiConnectionPut,
} from "@evolution/contracts";

async function request(path:string,init?:RequestInit){
  const response=await fetch("/api/evolution/"+path,init);
  const body=await response.json().catch(()=>({})) as {statusMessage?:string;message?:string};
  if(!response.ok){
    if(response.status===401||response.status===403)throw new Error("请先连接后端工作区，再保存或测试后端模型。");
    throw new Error(body.statusMessage??body.message??"后端模型服务暂不可用。");
  }
  return body;
}

export async function readServerAiConnection(){
  return ServerAiConnectionStatusSchema.parse(await request("ai-connection"));
}

export async function saveServerAiConnection(input:ServerAiConnectionPut){
  const value=ServerAiConnectionPutSchema.parse(input);
  return ServerAiConnectionStatusSchema.parse(await request("ai-connection",{
    method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),
  }));
}

export async function testServerAiConnection(input:ServerAiConnectionPut){
  const value=ServerAiConnectionPutSchema.parse(input);
  return ServerAiRuntimeHealthSchema.parse(await request("ai-connection-test",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),
  }));
}
