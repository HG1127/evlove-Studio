import { serverEnv } from "./env";
import { createHttpProductionPorts } from "@evolution/adapters";
import { type ProductionRuntimePorts } from "@evolution/contracts";
import { localProductionPorts } from "./local-production-adapters";

let configured:ProductionRuntimePorts|undefined;
let configuredMode:ProductionRuntimeMode|undefined;
let automaticHttpRuntime:ProductionRuntimePorts|undefined;

export type ProductionRuntimeMode = "local" | "http";

export function configureProductionRuntime(ports:ProductionRuntimePorts,mode:ProductionRuntimeMode="local"){configured=ports;configuredMode=mode;}
export function resetProductionRuntime(){configured=undefined;configuredMode=undefined;automaticHttpRuntime=undefined;}

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
  automaticHttpRuntime??=createHttpProductionPorts(serverEnv.EVOLUTION_API_URL?.trim()||"/api/evolution");
  return automaticHttpRuntime;
}
