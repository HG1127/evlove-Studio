import {httpApiErrorDetail} from "@evolution/adapters";
import {
  EvolutionBackendHealthSchema,
  EvolutionWorkflowCapabilitiesSchema,
  EvolutionWorkflowStartResponseSchema,
  EvolutionWorkflowStatusQuerySchema,
  EvolutionWorkflowStatusResponseSchema,
  PublicReadinessSnapshotSchema,
  SandboxBrowserHealthSchema,
  SandboxHealthSchema,
  SandboxAuthorizationDiagnosticSchema,
  ServerAiRuntimeHealthSchema,
  type EvolutionBackendHealth,
  type EvolutionWorkflowCapabilities,
  type EvolutionWorkflowStartResponse,
  type EvolveProject,
  type PublicReadinessSnapshot,
  type SandboxBrowserHealth,
  type SandboxHealth,
  type SandboxAuthorizationDiagnostic,
  type ServerAiRuntimeHealth,
} from "@evolution/contracts";
import { projectHasOnlineReleaseTarget,projectUsesConnectorRelease,projectUsesHttpRelease,projectUsesVercelRelease,requiresSandboxHtmlSourceExecution } from "@evolution/core";

async function apiJson(url:string,init?:RequestInit){
  const response=await fetch(url,init);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const detail=httpApiErrorDetail(data)??`Workflow API HTTP ${response.status}`;
    const inner=data&&typeof data==="object"&&"data" in data
      ?(data as {data?:{code?:unknown;action?:unknown}}).data:undefined;
    const htmlRuntimeCode=["HTML_SANDBOX_NOT_READY","HTML_BROWSER_NOT_READY","HTML_MIXED_TARGET_UNSUPPORTED"]
      .includes(typeof inner?.code==="string"?inner.code:"");
    const remediation=htmlRuntimeCode&&typeof inner?.action==="string"
      ?inner.action.trim().slice(0,260):"";
    throw new Error(remediation?`${detail}；处理方式：${remediation}`:detail);
  }
  return data;
}

let capabilityCache:{value:EvolutionWorkflowCapabilities;at:number}|undefined;

export async function getServerWorkflowCapabilities(force=false){
  if(!force&&capabilityCache&&Date.now()-capabilityCache.at<15_000)return capabilityCache.value;
  const value=EvolutionWorkflowCapabilitiesSchema.parse(await apiJson(force?"/api/evolution/capabilities?probeAi=1":"/api/evolution/capabilities"));
  capabilityCache={value,at:Date.now()};
  return value;
}

export async function checkServerBackendHealth():Promise<EvolutionBackendHealth>{
  return EvolutionBackendHealthSchema.parse(await apiJson("/api/evolution/backend-health"));
}

export async function checkServerAiRuntimeHealth():Promise<ServerAiRuntimeHealth>{
  return ServerAiRuntimeHealthSchema.parse(await apiJson("/api/evolution/ai-health"));
}

export async function checkPublicReadiness():Promise<PublicReadinessSnapshot>{
  return PublicReadinessSnapshotSchema.parse(await apiJson("/api/evolution/public-readiness"));
}

export async function startServerEvolutionWorkflow(
  missionId:string,
  options?:{scheduledFor?:string;idempotencyKey?:string},
):Promise<EvolutionWorkflowStartResponse>{
  const data=await apiJson("/api/evolution/start",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      missionId,
      ...(options?.scheduledFor?{scheduledFor:options.scheduledFor}:{}),
      ...(options?.idempotencyKey?{idempotencyKey:options.idempotencyKey}:{}),
    }),
  });
  const receipt=EvolutionWorkflowStartResponseSchema.parse(data);
  if(receipt.missionId!==missionId)throw new Error("Workflow start Mission identity mismatch");
  return receipt;
}

export async function getServerEvolutionWorkflowStatus(input:{runId?:string;jobId?:string}){
  const parsed=EvolutionWorkflowStatusQuerySchema.parse(input);
  const query=new URLSearchParams();
  if(parsed.runId)query.set("runId",parsed.runId);
  if(parsed.jobId)query.set("jobId",parsed.jobId);
  const status=EvolutionWorkflowStatusResponseSchema.parse(await apiJson("/api/evolution/status?"+query.toString()));
  if(parsed.jobId&&status.job&&status.job.id!==parsed.jobId)throw new Error("Workflow status Job identity mismatch");
  return status;
}

/** Passive authenticated configuration check: never spawns a metered Sandbox. */
export async function getServerSandboxAuthorizationDiagnostic():Promise<SandboxAuthorizationDiagnostic>{
  return SandboxAuthorizationDiagnosticSchema.parse(await apiJson("/api/evolution/sandbox-auth-status"));
}

export async function checkServerSandboxHealth():Promise<SandboxHealth>{
  return SandboxHealthSchema.parse(await apiJson("/api/evolution/sandbox-health"));
}

export async function checkServerBrowserHealth():Promise<SandboxBrowserHealth>{
  return SandboxBrowserHealthSchema.parse(await apiJson("/api/evolution/browser-health"));
}

/** HTML Target cannot be verified by local Harness or a connectivity-only Proxy. */
export function requiresIsolatedHtmlServerExecution(project:EvolveProject){
  return requiresSandboxHtmlSourceExecution(project);
}

export async function shouldUseServerAutoPilot(project:EvolveProject){
  try{
    const capability=await getServerWorkflowCapabilities(true);
    if(!capability.available||!capability.durable)return false;
    const gitSourceReady=project.targetConnection.adapter!=="git"
      ||Boolean(
        project.targetConnection.status==="connected"
        &&project.targetConnection.git
        &&capability.backend.gitTargetConfigured
      );
    if(!gitSourceReady)return false;
    const connectorSourceReady=project.targetConnection.adapter!=="connector"
      ||Boolean(
        project.targetConnection.status==="connected"
        &&project.targetConnection.connector
        &&capability.backend.connectorExperimentIds.includes(project.targetConnection.connector.connectorId)
      );
    if(!connectorSourceReady)return false;
    if(!projectHasOnlineReleaseTarget(project))return capability.closure.offlineFullAuto;
    const authorized=project.gates.find((gate)=>gate.id==="release-ready")?.status==="approved";
    if(!authorized||!capability.closure.offlineFullAuto)return false;
    if(projectUsesVercelRelease(project)){
      return Boolean(capability.backend.vercelReleaseConfigured);
    }
    if(projectUsesHttpRelease(project)){
      return Boolean(capability.backend.targetReleaseConfigured&&capability.backend.targetObserveConfigured);
    }
    if(projectUsesConnectorRelease(project)){
      const connectorId=project.targetConnection.connector?.connectorId;
      return Boolean(connectorId&&capability.backend.connectorFullLifecycleIds.includes(connectorId));
    }
    return false;
  }catch{
    return false;
  }
}
