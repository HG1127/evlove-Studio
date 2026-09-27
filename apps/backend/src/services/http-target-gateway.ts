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
  const frozen=input.frozenArtifacts??[];
  if(input.action==="rollback"&&frozen.length)throw new Error("HTTP Rollback 不应重新提交 Candidate Artifact。");
  if(input.action!=="rollback"&&(!input.candidate.artifactSnapshots.length||!frozen.length)){
    throw new Error("HTTP Release 缺少 Gate F 冻结文件载荷，不能执行无文件绑定的发布。");
  }
  if(frozen.length){
    const snapshots=new Map(input.candidate.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
    if(frozen.length!==snapshots.size||snapshots.size!==input.candidate.artifactSnapshots.length
      ||new Set(frozen.map((item)=>item.sourceArtifactId)).size!==frozen.length){
      throw new Error("HTTP Release 冻结文件未唯一覆盖 Candidate Snapshot。");
    }
    for(const item of frozen){
      const snapshot=snapshots.get(item.sourceArtifactId);
      if(!snapshot||snapshot.contentHash!==item.snapshotHash||snapshot.name!==item.name||snapshot.mimeType!==item.mimeType){
        throw new Error("HTTP Release 冻结文件与 Candidate Snapshot 身份不一致。");
      }
      const bytes=Buffer.from(item.contentBase64,"base64");
      if(bytes.toString("base64")!==item.contentBase64||bytes.byteLength!==item.size
        ||createHash("sha256").update(bytes).digest("hex")!==item.sha256){
        throw new Error("HTTP Release 冻结文件字节与 SHA-256 凭证不一致。");
      }
    }
  }
  const result=TargetReleaseProxyResponseSchema.parse(await post(getServerTargetProxyConfig().releaseUrl,input,"Target Release"));
  if(frozen.length){
    const received=result.artifactByteHashes??[];
    if(received.length!==frozen.length
      ||new Set(received.map((item)=>item.sourceArtifactId)).size!==received.length
      ||frozen.some((item)=>!received.some((receipt)=>receipt.sourceArtifactId===item.sourceArtifactId&&receipt.sha256===item.sha256))){
      throw new Error("HTTP Release 回执未确认 Gate F 冻结 Artifact 的实际字节 SHA-256。");
    }
  }
  return result;
}

export async function observeHttpTarget(raw:unknown){
  const input=TargetObserveProxyRequestSchema.parse(raw);
  const snapshots=new Map(input.candidate.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
  const expected=input.expectedArtifactByteHashes;
  if(snapshots.size!==input.candidate.artifactSnapshots.length||expected.length!==snapshots.size
    ||new Set(expected.map((item)=>item.sourceArtifactId)).size!==expected.length
    ||expected.some((item)=>!snapshots.has(item.sourceArtifactId))){
    throw new Error("HTTP Observe 预期字节 SHA-256 未唯一覆盖 Candidate Target。");
  }
  const result=TargetObserveProxyResponseSchema.parse(await post(getServerTargetProxyConfig().observeUrl,input,"Target Observe"));
  if(result.effectiveAction!=="rollback"){
    const received=result.artifactByteHashes??[];
    if(received.length!==expected.length
      ||new Set(received.map((item)=>item.sourceArtifactId)).size!==received.length
      ||expected.some((item)=>!received.some((receipt)=>receipt.sourceArtifactId===item.sourceArtifactId&&receipt.sha256===item.sha256))){
      throw new Error("HTTP Observe 回执未独立确认已部署 Artifact 的 Gate F 字节 SHA-256。");
    }
  }
  return result;
}
