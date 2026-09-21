import {
  EvolutionBackendHealthSchema,
  EvolutionWorkflowCapabilitiesSchema,
  EvolutionWorkflowStartResponseSchema,
  SandboxBrowserHealthSchema,
  SandboxHealthSchema,
  type EvolutionBackendHealth,
  type EvolutionWorkflowCapabilities,
  type EvolutionWorkflowStartResponse,
  type EvolveProject,
  type SandboxBrowserHealth,
  type SandboxHealth,
} from "@evolution/contracts";
import { projectHasOnlineReleaseTarget } from "@evolution/core";

async function apiJson(url:string,init?:RequestInit){
  const response=await fetch(url,init);
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error((data as {message?:string;error?:string}).message||(data as {error?:string}).error||`Workflow API HTTP ${response.status}`);
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

export async function startServerEvolutionWorkflow(missionId:string):Promise<EvolutionWorkflowStartResponse>{
  const data=await apiJson("/api/evolution/start",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({missionId}),
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
    if(!projectHasOnlineReleaseTarget(project))return capability.closure.offlineFullAuto;
    const authorized=project.gates.find((gate)=>gate.id==="release-ready")?.status==="approved";
    const supported=project.releaseTarget?.provider==="vercel";
    return Boolean(authorized&&supported&&capability.closure.onlinePostApprovalAuto);
  }catch{
    return false;
  }
}
