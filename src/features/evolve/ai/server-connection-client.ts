import {
  ServerAiConnectionPutSchema,ServerAiConnectionStatusSchema,ServerAiRuntimeHealthSchema,ServerAiConnectionRoleSchema,
  type ServerAiConnectionPut,type ServerAiConnectionRole,
} from "@evolution/contracts";

async function request(path:string,init?:RequestInit){
  const response=await fetch("/api/evolution/"+path,{cache:"no-store",...init});
  const body=await response.json().catch(()=>({})) as {statusMessage?:string;message?:string};
  if(!response.ok){
    if(response.status===401||response.status===403)throw new Error("请先连接后端工作区，再保存或测试后端模型。");
    if(response.status===404&&path==="ai-judge-connection")throw new Error("当前后端尚不支持独立验收模型，请先更新后端。");
    throw new Error(body.statusMessage??body.message??"后端模型服务暂不可用。");
  }
  return body;
}

// A dedicated path fails with 404 on old servers; a query parameter could be
// silently ignored and overwrite their generation default during rollback.
const rolePath=(role:ServerAiConnectionRole)=>ServerAiConnectionRoleSchema.parse(role)==="judge"?"ai-judge-connection":"ai-connection";

export async function readServerAiConnection(role:ServerAiConnectionRole="generation"){
  return ServerAiConnectionStatusSchema.parse(await request(rolePath(role)));
}

export async function saveServerAiConnection(input:ServerAiConnectionPut,role:ServerAiConnectionRole="generation"){
  const value=ServerAiConnectionPutSchema.parse(input);
  const receipt=ServerAiConnectionStatusSchema.parse(await request(rolePath(role),{
    method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),
  }));
  let saved:Awaited<ReturnType<typeof readServerAiConnection>>;
  try{saved=await readServerAiConnection(role);}
  catch{throw new Error("保存请求已提交，但回读未确认。请重新检查保存状态，暂不要重复保存。");}
  const expected={...value,baseUrl:value.baseUrl.replace(/\/+$/,"").replace(/\/(?:responses|chat\/completions)$/i,"")};
  const fields=["connectionId","label","baseUrl","model","protocol","responseFormat"] as const;
  if(!receipt.configured||receipt.revision===undefined||!saved.configured||!saved.connection||
    saved.revision!==receipt.revision||fields.some(field=>saved.connection![field]!==expected[field])){
    throw new Error("保存请求已提交，但后端回读与本次配置不一致。请重新检查保存状态，确认是否有其他页面同时修改。");
  }
  return saved;
}

export async function testServerAiConnection(input:ServerAiConnectionPut){
  const value=ServerAiConnectionPutSchema.parse(input);
  return ServerAiRuntimeHealthSchema.parse(await request("ai-connection-test",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),
  }));
}
