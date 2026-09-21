import {
  ConnectorActionResponseSchema,
  ConnectorRegistryCapabilitiesSchema,
  type ConnectorActionRequest,
  type ConnectorActionResponse,
  type ConnectorRegistryCapabilities,
} from "@evolution/contracts";

async function apiJson(path:string,init?:RequestInit){
  const response=await fetch(path,init);
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String((body as {statusMessage?:string;message?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Connector API HTTP ${response.status}`);
    throw new Error(message);
  }
  return body;
}

export async function getServerConnectorCapabilities():Promise<ConnectorRegistryCapabilities>{
  return ConnectorRegistryCapabilitiesSchema.parse(await apiJson("/api/evolution/connector-capabilities"));
}

export async function runServerConnectorAction(input:ConnectorActionRequest):Promise<ConnectorActionResponse>{
  return ConnectorActionResponseSchema.parse(await apiJson("/api/evolution/connector-action",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(input),
  }));
}
