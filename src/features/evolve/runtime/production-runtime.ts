import { serverEnv } from "./env";
import { createHttpProductionPorts } from "@evolution/adapters";
import { type ProductionRuntimePorts } from "@evolution/contracts";
import { localProductionPorts } from "./local-production-adapters";

let configured:ProductionRuntimePorts|undefined;
let configuredMode:ProductionRuntimeMode|undefined;
let automaticHttpRuntime:ProductionRuntimePorts|undefined;
let artifactReadSession:string|undefined,httpWorkspaceId:string|undefined;

export type ProductionRuntimeMode = "local" | "http";

export function configureProductionRuntime(ports:ProductionRuntimePorts,mode:ProductionRuntimeMode="local"){configured=ports;configuredMode=mode;artifactReadSession=undefined;httpWorkspaceId=undefined;}
export function resetProductionRuntime(){configured=undefined;configuredMode=undefined;automaticHttpRuntime=undefined;artifactReadSession=undefined;httpWorkspaceId=undefined;}

/** Session receipts never cross runtime instances; persistent receipts also bind backend and workspace. */
export function productionArtifactReadScopes(){
 artifactReadSession??=crypto.randomUUID();
 const endpoint=new URL(serverEnv.EVOLUTION_API_URL?.trim()||"/api/evolution",typeof window!=="undefined"?window.location.origin:"http://localhost").href;
 return ["session:"+artifactReadSession,...(httpWorkspaceId?[endpoint+"#workspace="+encodeURIComponent(httpWorkspaceId)]:[])];
}

export function productionRuntimeMode():ProductionRuntimeMode{
  if(configured)return configuredMode??"local";
  if(import.meta.env.MODE==="test")return "local";
  if(serverEnv.EVOLUTION_API_URL?.trim())return "http";
  if(import.meta.env.PROD)return "http";
  return "local";
}

export function getProductionRuntime():ProductionRuntimePorts{
  if(configured)return configured;
  const mode=productionRuntimeMode();
  if(mode==="local")return localProductionPorts;
  automaticHttpRuntime??=createHttpProductionPorts(serverEnv.EVOLUTION_API_URL?.trim()||"/api/evolution",{missionIndex:true,missionStream:true,onMissionReadProgress:progress=>{if(httpWorkspaceId!==undefined&&httpWorkspaceId!==progress.workspaceId)artifactReadSession=undefined;httpWorkspaceId=progress.workspaceId;if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent("evolve-mission-read-progress",{detail:progress}));}});
  return automaticHttpRuntime;
}
