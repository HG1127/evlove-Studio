import { serverEnv } from "./env";
import { createHttpProductionPorts, createSupabaseProductionPorts } from "@evolution/adapters";
import { SupabaseBackendConfigSchema, type ProductionRuntimePorts, type SupabaseBackendConfig } from "@evolution/contracts";
import { localProductionPorts } from "./local-production-adapters";

let configured:ProductionRuntimePorts|undefined;

export type ProductionRuntimeMode = "local" | "supabase" | "http";

export function configureProductionRuntime(ports:ProductionRuntimePorts){configured=ports;}
export function resetProductionRuntime(){configured=undefined;}

export function getSupabaseRuntimeConfig():SupabaseBackendConfig|undefined{
  const parsed=SupabaseBackendConfigSchema.safeParse({
    url:serverEnv.SUPABASE_URL?.trim(),
    anonKey:serverEnv.SUPABASE_ANON_KEY?.trim(),
    artifactBucket:serverEnv.SUPABASE_ARTIFACT_BUCKET?.trim()||"evolution-artifacts",
  });
  return parsed.success?parsed.data:undefined;
}

export function productionRuntimeMode():ProductionRuntimeMode{
  if(serverEnv.EVOLUTION_API_URL?.trim())return "http";
  if(getSupabaseRuntimeConfig())return "supabase";
  return "local";
}

export function getProductionRuntime():ProductionRuntimePorts{
  if(configured)return configured;
  const api=serverEnv.EVOLUTION_API_URL?.trim();
  if(api)return createHttpProductionPorts(api);
  const supabase=getSupabaseRuntimeConfig();
  return supabase?createSupabaseProductionPorts(supabase):localProductionPorts;
}
