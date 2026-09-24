import {createHash} from "node:crypto";
import {z} from "zod";
import {
  TargetProxyCapabilitiesSchema,
  TargetObserveProxyRequestSchema,
  TargetObserveProxyResponseSchema,
  TargetReleaseProxyRequestSchema,
  TargetReleaseProxyResponseSchema,
  TargetRunProxyRequestSchema,
  TargetRunProxyResponseSchema,
} from "@evolution/contracts";
import {getServerTargetProxyConfig,targetProxyCapabilities as serverCaps} from "../server-env";

// Keep the shared legacy result contract compatible, but do not let its
// verificationStatus default turn a missing provider verdict into "verified".
const ExplicitTargetRunResponseSchema=TargetRunProxyResponseSchema.extend({
  verificationStatus:z.enum(["verified","partial","unverified","failed"]),
});

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
  const result=ExplicitTargetRunResponseSchema.parse(await post(getServerTargetProxyConfig().runUrl,input,"Target Run"));
  if(result.testCaseId!==input.testCase.id)throw new Error("Target Run result belongs to another Test Case");
  if(result.verificationStatus!=="unverified"&&(input.artifact||input.archiveBase64)){
    const bytes=input.archiveBase64?Buffer.from(input.archiveBase64,"base64"):Buffer.from(input.artifact!.content,"utf8");
    const expected=createHash("sha256").update(bytes).digest("hex");
    if(result.artifactHash?.toLowerCase()!==expected){
      throw new Error("Target Run result does not match the submitted Artifact SHA-256");
    }
  }
  return result;
}

export async function releaseHttpTarget(raw:unknown){
  const input=TargetReleaseProxyRequestSchema.parse(raw);
  return TargetReleaseProxyResponseSchema.parse(await post(getServerTargetProxyConfig().releaseUrl,input,"Target Release"));
}

export async function observeHttpTarget(raw:unknown){
  const input=TargetObserveProxyRequestSchema.parse(raw);
  return TargetObserveProxyResponseSchema.parse(await post(getServerTargetProxyConfig().observeUrl,input,"Target Observe"));
}
