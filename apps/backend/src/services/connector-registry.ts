import {
  ConnectorActionRequestSchema,
  ConnectorActionResponseSchema,
  ConnectorRegistryCapabilitiesSchema,
  ConnectorServerManifestSchema,
  type ConnectorActionRequest,
  type ConnectorLifecycleOperation,
  type ConnectorServerManifest,
} from "@evolution/contracts";
import {getVaultSecretMetadata,resolveVaultSecret} from "./server-vault";

const OPERATIONS=["read","snapshot","mutate","validate","deploy","observe","rollback"] as const;

function configError(message:string){
  const error=new Error(message);
  (error as Error&{code?:string}).code="CONNECTOR_REGISTRY_INVALID";
  return error;
}

function assertManifestSafe(manifest:ConnectorServerManifest){
  const base=new URL(manifest.baseUrl);
  const local=["localhost","127.0.0.1","::1"].includes(base.hostname);
  if(process.env.NODE_ENV==="production"&&base.protocol!=="https:"){
    throw configError(`Connector ${manifest.id} must use HTTPS in production`);
  }
  if(base.protocol!=="https:"&&base.protocol!=="http:"){
    throw configError(`Connector ${manifest.id} has unsupported protocol`);
  }
  if(process.env.NODE_ENV==="production"&&local){
    throw configError(`Connector ${manifest.id} cannot target localhost in production`);
  }
  for(const [operation,path] of Object.entries(manifest.paths)){
    if(!path.startsWith("/")||path.startsWith("//")||path.includes("://")){
      throw configError(`Connector ${manifest.id} ${operation} path must be an absolute-path reference`);
    }
  }
  return manifest;
}

export function getServerConnectorManifests(){
  const raw=process.env.EVOLUTION_CONNECTORS_JSON?.trim();
  if(!raw)return[] as ConnectorServerManifest[];
  if(raw.length>100_000)throw configError("EVOLUTION_CONNECTORS_JSON is too large");
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw configError("EVOLUTION_CONNECTORS_JSON is not valid JSON");}
  const manifests=ConnectorServerManifestSchema.array().max(50).parse(parsed).map(assertManifestSafe);
  const ids=new Set<string>();
  for(const manifest of manifests){
    if(ids.has(manifest.id))throw configError(`Duplicate connector id: ${manifest.id}`);
    ids.add(manifest.id);
  }
  return manifests;
}

async function vaultRefConfigured(id:string|undefined){
  if(!id)return true;
  return Boolean(await getVaultSecretMetadata(id).catch(()=>undefined));
}

async function credentialConfigured(manifest:ConnectorServerManifest){
  if(manifest.credentialEnv)return Boolean(process.env[manifest.credentialEnv]?.trim());
  if(manifest.credentialVaultId)return vaultRefConfigured(manifest.credentialVaultId);
  return true;
}

async function webhookConfigured(manifest:ConnectorServerManifest){
  if(manifest.webhookSecretEnv)return Boolean(process.env[manifest.webhookSecretEnv]?.trim());
  if(manifest.webhookSecretVaultId)return vaultRefConfigured(manifest.webhookSecretVaultId);
  return true;
}

function lifecycle(manifest:ConnectorServerManifest){
  return Object.fromEntries(OPERATIONS.map((operation)=>[operation,Boolean(manifest.paths[operation])])) as Record<ConnectorLifecycleOperation,boolean>;
}

export function connectorManifestDeclaresFullLifecycle(manifest:ConnectorServerManifest){
  const declared=lifecycle(manifest);
  return manifest.mutationMode==="staged-version"&&OPERATIONS.every((operation)=>declared[operation]);
}

export async function getConnectorRegistryCapabilities(){
  const connectors=await Promise.all(getServerConnectorManifests().map(async(manifest)=>({
    id:manifest.id,
    label:manifest.label,
    targetType:manifest.targetType,
    mutationMode:manifest.mutationMode,
    lifecycle:lifecycle(manifest),
    credentialConfigured:await credentialConfigured(manifest),
    webhookConfigured:await webhookConfigured(manifest),
    credentialProvider:manifest.credentialVaultId?"vault":manifest.credentialEnv?"env":"none",
    webhookProvider:manifest.webhookSecretVaultId?"vault":manifest.webhookSecretEnv?"env":"none",
  })));
  const fullLifecycleCount=connectors.filter((connector)=>
    connector.credentialConfigured
      &&connector.mutationMode==="staged-version"
      &&OPERATIONS.every((operation)=>connector.lifecycle[operation]),
  ).length;
  return ConnectorRegistryCapabilitiesSchema.parse({
    codeReady:true,
    configured:connectors.length>0,
    connectorCount:connectors.length,
    fullLifecycleCount,
    connectors,
  });
}

function resolveManifest(id:string){
  const manifest=getServerConnectorManifests().find((item)=>item.id===id);
  if(!manifest){
    const error=new Error(`Connector ${id} is not registered on server`);
    (error as Error&{code?:string}).code="CONNECTOR_NOT_REGISTERED";
    throw error;
  }
  return manifest;
}

export function assertConnectorCandidateIsolation(connectorId:string){
  const manifest=resolveManifest(connectorId);
  if(manifest.mutationMode!=="staged-version"){
    const error=new Error(
      `Connector ${connectorId} mutate is not declared as staged-version; Candidate experiments refuse direct mutation`,
    );
    (error as Error&{code?:string}).code="CONNECTOR_MUTATION_ISOLATION_REQUIRED";
    throw error;
  }
  return manifest;
}

function endpoint(manifest:ConnectorServerManifest,operation:ConnectorLifecycleOperation){
  const path=manifest.paths[operation];
  if(!path){
    const error=new Error(`Connector ${manifest.id} does not support ${operation}`);
    (error as Error&{code?:string}).code="CONNECTOR_OPERATION_UNSUPPORTED";
    throw error;
  }
  return new URL(path,manifest.baseUrl.endsWith("/")?manifest.baseUrl:manifest.baseUrl+"/").toString();
}

async function authHeader(manifest:ConnectorServerManifest):Promise<Record<string,string>>{
  if(!manifest.credentialEnv&&!manifest.credentialVaultId)return {};
  const token=manifest.credentialVaultId
    ?await resolveVaultSecret(manifest.credentialVaultId,`connector:${manifest.id}:credential`)
    :process.env[manifest.credentialEnv!]?.trim();
  if(!token){
    const error=new Error(`Connector ${manifest.id} credential is not configured`);
    (error as Error&{code?:string}).code="CONNECTOR_CREDENTIAL_REQUIRED";
    throw error;
  }
  return {Authorization:`Bearer ${token}`};
}

export async function executeConnectorAction(raw:ConnectorActionRequest){
  const input=ConnectorActionRequestSchema.parse(raw);
  const manifest=resolveManifest(input.connectorId);
  const url=endpoint(manifest,input.operation);
  const requestHeaders:Record<string,string>={
    "Content-Type":"application/json",
    "X-Evolution-Connector-Operation":input.operation,
    ...await authHeader(manifest),
  };
  if(input.idempotencyKey)requestHeaders["Idempotency-Key"]=input.idempotencyKey;
  const response=await fetch(url,{
    method:"POST",
    headers:requestHeaders,
    signal:AbortSignal.timeout(90_000),
    body:JSON.stringify({
      missionId:input.missionId,
      targetId:input.targetId,
      expectedVersionRef:input.expectedVersionRef,
      idempotencyKey:input.idempotencyKey,
      payload:input.payload,
    }),
  });
  const body=await response.json().catch(()=>({})) as Record<string,unknown>;
  if(!response.ok){
    const detail=typeof body.message==="string"?body.message:`HTTP ${response.status}`;
    throw new Error(`Connector ${manifest.id} ${input.operation} failed: ${detail}`);
  }
  return ConnectorActionResponseSchema.parse({
    ...body,
    connectorId:manifest.id,
    operation:input.operation,
    targetId:input.targetId,
    observedAt:typeof body.observedAt==="string"?body.observedAt:new Date().toISOString(),
    note:typeof body.note==="string"?body.note:`Connector ${input.operation} completed`,
  });
}

export async function connectorWebhookSecret(connectorId:string){
  const manifest=resolveManifest(connectorId);
  if(!manifest.webhookSecretEnv&&!manifest.webhookSecretVaultId){
    const error=new Error(`Connector ${connectorId} webhook is not configured`);
    (error as Error&{code?:string}).code="CONNECTOR_WEBHOOK_NOT_CONFIGURED";
    throw error;
  }
  const secret=manifest.webhookSecretVaultId
    ?await resolveVaultSecret(manifest.webhookSecretVaultId,`connector:${manifest.id}:webhook`)
    :process.env[manifest.webhookSecretEnv!]?.trim();
  if(!secret){
    const error=new Error(`Connector ${connectorId} webhook secret is missing`);
    (error as Error&{code?:string}).code="CONNECTOR_WEBHOOK_SECRET_REQUIRED";
    throw error;
  }
  return secret;
}
