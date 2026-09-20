import { serverEnv } from "./env";
import { createHttpProductionPorts, createSupabaseProductionPorts } from "@evolution/adapters";
import { SupabaseBackendConfigSchema, type ProductionRuntimePorts, type SupabaseBackendConfig } from "@evolution/contracts";
import { localProductionPorts } from "./local-production-adapters";

let configured:ProductionRuntimePorts|undefined;
let configuredMode:ProductionRuntimeMode|undefined;

export type ProductionRuntimeMode = "local" | "supabase" | "http";

export function configureProductionRuntime(ports:ProductionRuntimePorts,mode:ProductionRuntimeMode="local"){configured=ports;configuredMode=mode;}
export function resetProductionRuntime(){configured=undefined;configuredMode=undefined;}

export function getSupabaseRuntimeConfig():SupabaseBackendConfig|undefined{
  const parsed=SupabaseBackendConfigSchema.safeParse({
    url:serverEnv.SUPABASE_URL?.trim(),
    anonKey:serverEnv.SUPABASE_ANON_KEY?.trim(),
    artifactBucket:serverEnv.SUPABASE_ARTIFACT_BUCKET?.trim()||"evolution-artifacts",
  });
  return parsed.success?parsed.data:undefined;
}

export function productionRuntimeMode():ProductionRuntimeMode{
  if(configured)return configuredMode??"local";
  if(import.meta.env.MODE==="test")return "local";
  if(serverEnv.EVOLUTION_API_URL?.trim())return "http";
  if(getSupabaseRuntimeConfig())return "supabase";
  return "local";
}

export function getProductionRuntime():ProductionRuntimePorts{
  if(configured)return configured;
  const mode=productionRuntimeMode();
  if(mode==="local")return localProductionPorts;
  if(mode==="http")return createHttpProductionPorts(serverEnv.EVOLUTION_API_URL!.trim());
  return createSupabaseProductionPorts(getSupabaseRuntimeConfig()!);
}
