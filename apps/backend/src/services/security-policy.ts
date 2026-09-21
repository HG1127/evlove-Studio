import {createHmac,timingSafeEqual} from "node:crypto";
import {createError,getHeader,type H3Event} from "nitro/h3";
import {
  EvolutionActorSchema,
  SecurityCapabilitiesSchema,
  type EvolutionActor,
  type EvolutionPermission,
  type EvolutionRole,
} from "@evolution/contracts";
import {
  capabilityEmbeddingConfigured,
  evidenceLedgerConfigured,
  getServerSecurityConfig,
  getServerTargetProxyConfig,
  githubTargetConfigured,
  githubWebhookConfigured,
  serverAiConfigured,
  serverSupabaseSecureConfigured,
  vercelReleaseWriteConfigured,
} from "../server-env";

const ROLE_PERMISSIONS:Record<EvolutionRole,ReadonlySet<EvolutionPermission>>={
  viewer:new Set(["data.read","release.observe"]),
  operator:new Set(["data.read","release.observe","mission.write","mission.execute","ai.execute","target.execute","target.write","release.execute","capability.write","outcome.write"]),
  approver:new Set(["data.read","release.observe","release.approve"]),
  admin:new Set(["data.read","mission.write","mission.execute","ai.execute","target.execute","target.write","release.observe","release.execute","release.approve","capability.write","evidence.write","outcome.write","security.admin"]),
  service:new Set(["data.read","mission.write","mission.execute","ai.execute","target.execute","target.write","release.observe","release.execute","capability.write","evidence.write","outcome.write"]),
};

function secureEqual(left:string,right:string){
  const a=Buffer.from(left,"utf8"),b=Buffer.from(right,"utf8");
  return a.length===b.length&&timingSafeEqual(a,b);
}

function decodeActor(value:string):Record<string,unknown>{
  try{
    const parsed=JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
      throw new Error("actor payload must be an object");
    }
    return parsed as Record<string,unknown>;
  }catch{
    throw createError({statusCode:401,statusMessage:"Invalid Evolution actor header"});
  }
}

export function permissionAllowed(role:EvolutionRole,permission:EvolutionPermission){
  return ROLE_PERMISSIONS[role].has(permission);
}

export function resolveEvolutionActor(event:H3Event):EvolutionActor{
  const config=getServerSecurityConfig();
  if(config.mode==="blocked")throw createError({statusCode:503,statusMessage:"Evolution identity/RBAC is not configured"});
  if(config.mode==="internal-dev"){
    return EvolutionActorSchema.parse({
      id:"internal-dev",role:"admin",workspaceId:config.workspaceId,source:"internal-dev",
    });
  }
  const encoded=getHeader(event,"x-evolution-actor")??"";
  const signature=getHeader(event,"x-evolution-actor-signature")??"";
  if(!encoded||!signature)throw createError({statusCode:401,statusMessage:"Trusted Evolution actor headers are required"});
  const expected=createHmac("sha256",config.identitySecret!).update(encoded).digest("hex");
  if(!secureEqual(signature,expected))throw createError({statusCode:401,statusMessage:"Invalid Evolution actor signature"});
  const actor=EvolutionActorSchema.parse({...decodeActor(encoded),source:"trusted-header"});
  const now=Math.floor(Date.now()/1000);
  if(!actor.issuedAt||!actor.expiresAt)throw createError({statusCode:401,statusMessage:"Evolution actor issuedAt/expiresAt are required"});
  if(actor.issuedAt>now+60||actor.expiresAt<=now||actor.expiresAt-actor.issuedAt>config.maxActorAgeSeconds){
    throw createError({statusCode:401,statusMessage:"Evolution actor assertion expired or exceeds max age"});
  }
  if(config.workspaceId&&actor.workspaceId!==config.workspaceId){
    throw createError({statusCode:403,statusMessage:"Evolution actor workspace mismatch or missing workspace"});
  }
  return actor;
}

export function requireEvolutionPermission(event:H3Event,permission:EvolutionPermission){
  const actor=resolveEvolutionActor(event);
  if(!permissionAllowed(actor.role,permission)){
    throw createError({statusCode:403,statusMessage:`Role ${actor.role} lacks ${permission}`});
  }
  event.context.evolutionActor=actor;
  return actor;
}

function configured(...values:Array<string|undefined>){return values.some((value)=>Boolean(value?.trim()));}

export function getSecurityCapabilities(){
  const security=getServerSecurityConfig();
  const target=getServerTargetProxyConfig();
  const credentials=[
    {id:"supabase-data-plane",provider:"env" as const,envVars:["SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY"],purpose:"Server Data Plane / Object Store",configured:serverSupabaseSecureConfigured(),scopes:["database","storage"]},
    {id:"server-ai",provider:"env" as const,envVars:["EVOLUTION_AI_API_KEY","OPENAI_API_KEY"],purpose:"Server AI operations",configured:serverAiConfigured(),scopes:["ai"]},
    {id:"vercel-release",provider:"env" as const,envVars:["VERCEL_RELEASE_TOKEN"],purpose:"Production release writes",configured:vercelReleaseWriteConfigured(),scopes:["release"]},
    {id:"github-target",provider:"env" as const,envVars:["EVOLUTION_GITHUB_TOKEN"],purpose:"Git target lifecycle",configured:githubTargetConfigured(),scopes:["git"]},
    {id:"github-webhook",provider:"env" as const,envVars:["EVOLUTION_GITHUB_WEBHOOK_SECRET"],purpose:"GitHub webhook signature verification",configured:githubWebhookConfigured(),scopes:["webhook"]},
    {id:"target-proxy",provider:"env" as const,envVars:["EVOLUTION_TARGET_BEARER_TOKEN"],purpose:"External target gateway",configured:configured(target.token),scopes:["target"]},
    {id:"capability-embedding",provider:"env" as const,envVars:["EVOLUTION_CAPABILITY_EMBEDDING_API_KEY"],purpose:"Organization semantic capability matching",configured:capabilityEmbeddingConfigured(),scopes:["embedding"]},
    {id:"evidence-signing",provider:"env" as const,envVars:["EVOLUTION_EVIDENCE_SIGNING_KEY"],purpose:"Immutable Evidence Ledger HMAC",configured:evidenceLedgerConfigured(),scopes:["evidence"]},
  ];
  const configuredIdentity=security.mode!=="blocked";
  const productionSafe=security.mode==="trusted-header"&&Boolean(security.workspaceId)&&serverSupabaseSecureConfigured();
  return SecurityCapabilitiesSchema.parse({
    codeReady:true,
    mode:security.mode,
    configured:configuredIdentity,
    enforced:security.mode==="trusted-header",
    productionSafe,
    workspaceId:security.workspaceId,
    roles:Object.keys(ROLE_PERMISSIONS),
    credentials,
    checkedAt:new Date().toISOString(),
    message:productionSafe
      ?"Trusted actor RBAC + server-only credential references are production-safe."
      :security.mode==="internal-dev"
        ?"RBAC code is ready, but internal-dev identity is not production-safe."
        :"RBAC code is ready; configure a 32+ character EVOLUTION_IDENTITY_HMAC_SECRET, EVOLUTION_WORKSPACE_ID, and server-only data-plane credential.",
  });
}
