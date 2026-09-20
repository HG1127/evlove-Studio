import {
  VercelReleaseActionResponseSchema,
  VercelReleaseCapabilitiesSchema,
  VercelReleaseDeploymentsSchema,
  VercelReleaseHealthSchema,
  type VercelReleaseActionRequest,
} from "@evolution/contracts";

async function apiJson(path:string,init?:RequestInit){
  const response=await fetch(path,init);
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String((body as {statusMessage?:string;message?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Release API HTTP ${response.status}`);
    throw new Error(message);
  }
  return body;
}

export async function getServerVercelReleaseCapabilities(){
  return VercelReleaseCapabilitiesSchema.parse(await apiJson("/api/evolution/release-capabilities"));
}

export async function checkServerVercelReleaseHealth(){
  return VercelReleaseHealthSchema.parse(await apiJson("/api/evolution/release-health"));
}

export async function listServerVercelDeployments(){
  return VercelReleaseDeploymentsSchema.parse(await apiJson("/api/evolution/release-deployments"));
}

export async function runServerVercelReleaseAction(input:VercelReleaseActionRequest){
  return VercelReleaseActionResponseSchema.parse(await apiJson("/api/evolution/release-action",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(input),
  }));
}
