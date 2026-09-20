import { SupabaseBackendConfigSchema, type SupabaseBackendConfig } from "@evolution/contracts";

function value(...items:Array<string|undefined>) {
  return items.map((item)=>item?.trim()).find(Boolean);
}

export function getServerSupabaseConfig():SupabaseBackendConfig {
  const url=value(process.env.SUPABASE_URL,process.env.VITE_SUPABASE_URL);
  const key=value(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
  );
  const artifactBucket=value(process.env.SUPABASE_ARTIFACT_BUCKET,process.env.VITE_SUPABASE_ARTIFACT_BUCKET)
    ?? "evolution-artifacts";
  const parsed=SupabaseBackendConfigSchema.safeParse({url,anonKey:key,artifactBucket});
  if(!parsed.success){
    throw new Error("Server Supabase 配置缺失。请配置 SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY（或当前内部 MVP 的 VITE_SUPABASE_*）。");
  }
  return parsed.data;
}
export type ServerAiConfig=
  | {mode:"vercel-gateway";model:string;timeoutMs:number}
  | {mode:"openai-compatible";apiKey:string;model:string;baseUrl:string;timeoutMs:number};

function serverAiTimeoutMs(){
  const timeoutRaw=value(process.env.EVOLUTION_AI_TIMEOUT_MS,process.env.OPENAI_TIMEOUT_MS);
  return Math.max(10_000,Math.min(Number(timeoutRaw||"90000")||90_000,300_000));
}

export function serverAiOidcAvailable(){
  return Boolean(
    value(process.env.VERCEL_OIDC_TOKEN)
    || value(process.env.VERCEL)
    || value(process.env.VERCEL_ENV),
  );
}

function serverAiGatewayEnabled(){
  return /^(1|true|yes|on)$/i.test(value(process.env.EVOLUTION_AI_GATEWAY_ENABLED)??"");
}

export function getServerAiConfig():ServerAiConfig|undefined{
  const timeoutMs=serverAiTimeoutMs();
  const oidcAvailable=serverAiOidcAvailable();
  if(oidcAvailable&&serverAiGatewayEnabled()){
    return {
      mode:"vercel-gateway",
      model:value(process.env.EVOLUTION_AI_GATEWAY_MODEL,process.env.EVOLUTION_AI_MODEL)??"openai/gpt-5.5",
      timeoutMs,
    };
  }

  const apiKey=value(process.env.EVOLUTION_AI_API_KEY,process.env.OPENAI_API_KEY);
  const model=value(process.env.EVOLUTION_AI_MODEL,process.env.OPENAI_MODEL);
  if(!apiKey||!model)return undefined;
  const rawBase=value(process.env.EVOLUTION_AI_BASE_URL,process.env.OPENAI_BASE_URL)??"https://api.openai.com/v1";
  const baseUrl=rawBase.replace(/\/+$/,"").replace(/\/(?:responses|chat\/completions)$/i,"");
  return {mode:"openai-compatible",apiKey,model,baseUrl,timeoutMs};
}

export function serverAiConfigured(){return Boolean(getServerAiConfig());}

