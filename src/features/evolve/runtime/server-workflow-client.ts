import {
  EvolutionBackendHealthSchema,
  EvolutionWorkflowCapabilitiesSchema,
  EvolutionWorkflowStartResponseSchema,
  PublicReadinessSnapshotSchema,
  SandboxBrowserHealthSchema,
  SandboxHealthSchema,
  type EvolutionBackendHealth,
  type EvolutionWorkflowCapabilities,
  type EvolutionWorkflowStartResponse,
  type EvolveProject,
  type PublicReadinessSnapshot,
  type SandboxBrowserHealth,
  type SandboxHealth,
} from "@evolution/contracts";
import { projectHasOnlineReleaseTarget,projectUsesConnectorRelease,projectUsesHttpRelease,projectUsesVercelRelease } from "@evolution/core";

async function apiJson(url:string,init?:RequestInit){
  const response=await fetch(url,init);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const detail=data as {statusMessage?:string;message?:string;error?:string};
    throw new Error(detail.statusMessage||detail.message||detail.error||`Workflow API HTTP ${response.status}`);
  }
  return data;
}

let capabilityCache:{value:EvolutionWorkflowCapabilities;at:number}|undefined;

export async function getServerWorkflowCapabilities(force=false){
  if(!force&&capabilityCache&&Date.now()-capabilityCache.at<15_000)return capabilityCache.value;
  const value=EvolutionWorkflowCapabilitiesSchema.parse(await apiJson("/api/evolution/capabilities"));
  capabilityCache={value,at:Date.now()};
  return value;
}

export async function checkServerBackendHealth():Promise<EvolutionBackendHealth>{
  return EvolutionBackendHealthSchema.parse(await apiJson("/api/evolution/backend-health"));
}

export async function checkPublicReadiness():Promise<PublicReadinessSnapshot>{
  return PublicReadinessSnapshotSchema.parse(await apiJson("/api/evolution/public-readiness"));
}

export async function startServerEvolutionWorkflow(
  missionId:string,
  options?:{scheduledFor?:string},
):Promise<EvolutionWorkflowStartResponse>{
  const data=await apiJson("/api/evolution/start",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({missionId,...(options?.scheduledFor?{scheduledFor:options.scheduledFor}:{})}),
  });
  return EvolutionWorkflowStartResponseSchema.parse(data);
}

export async function getServerEvolutionWorkflowStatus(input:{runId?:string;jobId?:string}){
  const query=new URLSearchParams();
  if(input.runId)query.set("runId",input.runId);
  if(input.jobId)query.set("jobId",input.jobId);
  if(!query.size)throw new Error("需要 runId 或 jobId");
  return apiJson("/api/evolution/status?"+query.toString()) as Promise<{
    workflow?:{exists:boolean;status?:unknown};
    job?:unknown;
    events?:unknown[];
  }>;
}

export async function checkServerSandboxHealth():Promise<SandboxHealth>{
  return SandboxHealthSchema.parse(await apiJson("/api/evolution/sandbox-health"));
}

export async function checkServerBrowserHealth():Promise<SandboxBrowserHealth>{
  return SandboxBrowserHealthSchema.parse(await apiJson("/api/evolution/browser-health"));
}

export async function shouldUseServerAutoPilot(project:EvolveProject){
  try{
    const capability=await getServerWorkflowCapabilities();
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
