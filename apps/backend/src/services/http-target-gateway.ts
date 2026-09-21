import {
  TargetProxyCapabilitiesSchema,
  TargetReleaseProxyRequestSchema,
  TargetReleaseProxyResponseSchema,
  TargetRunProxyRequestSchema,
  TargetRunProxyResponseSchema,
} from "@evolution/contracts";
import {getServerTargetProxyConfig,targetProxyCapabilities as serverCaps} from "../server-env";

function headers(){
  const token=getServerTargetProxyConfig().token;
  return {"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})};
}

async function executionError(response:Response,action:string){
  const text=await response.text().catch(()=>"");
  return new Error(`${action} failed (HTTP ${response.status})${text?`: ${text.slice(0,500)}`:""}`);
}

async function post(url:string|undefined,body:unknown,action:string){
  const config=getServerTargetProxyConfig();
  if(!url){
    const error=new Error(`${action} target endpoint is not configured on server`);
    (error as Error&{code?:string}).code="TARGET_PROXY_NOT_CONFIGURED";
    throw error;
  }
  const response=await fetch(url,{
    method:"POST",headers:headers(),signal:AbortSignal.timeout(config.timeoutMs),body:JSON.stringify(body),
  });
  if(!response.ok)throw await executionError(response,action);
  return response.json();
}

export function getHttpTargetGatewayCapabilities(){
  return TargetProxyCapabilitiesSchema.parse(serverCaps());
}

export async function runHttpTarget(raw:unknown){
  const input=TargetRunProxyRequestSchema.parse(raw);
  return TargetRunProxyResponseSchema.parse(await post(getServerTargetProxyConfig().runUrl,input,"Target Run"));
}

export async function releaseHttpTarget(raw:unknown){
  const input=TargetReleaseProxyRequestSchema.parse(raw);
  return TargetReleaseProxyResponseSchema.parse(await post(getServerTargetProxyConfig().releaseUrl,input,"Target Release"));
}
