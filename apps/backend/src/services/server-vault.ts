import {createCipheriv,createDecipheriv,createHash,randomBytes} from "node:crypto";
import {
  VaultSecretDeleteResponseSchema,
  VaultSecretListResponseSchema,
  VaultSecretMetadataSchema,
  VaultSecretPutRequestSchema,
  VaultSecretPutResponseSchema,
  type EvolutionActor,
  type VaultSecretMetadata,
  type VaultSecretPutRequest,
} from "@evolution/contracts";
import {
  getEvolutionWorkspaceId,
  getServerSupabaseConfig,
  getVaultEncryptionConfig,
  vaultEncryptionConfigured,
} from "../server-env";

type JsonRecord=Record<string,unknown>;
type VaultRow=JsonRecord&{
  workspace_id?:unknown;
  id?:unknown;
  name?:unknown;
  purpose?:unknown;
  scopes?:unknown;
  version?:unknown;
  key_id?:unknown;
  algorithm?:unknown;
  ciphertext?:unknown;
  iv?:unknown;
  auth_tag?:unknown;
  created_by?:unknown;
  created_at?:unknown;
  updated_at?:unknown;
};

function derivedKey(secret:string){
  return createHash("sha256").update(secret,"utf8").digest();
}

function aad(input:{workspaceId:string;id:string;version:number;keyId:string}){
  return Buffer.from(
    ["evolution-vault-v1",input.workspaceId,input.id,String(input.version),input.keyId].join("\u0000"),
    "utf8",
  );
}

export function encryptVaultValue(args:{
  value:string;
  workspaceId:string;
  id:string;
  version:number;
  keyId:string;
  key:string;
}){
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",derivedKey(args.key),iv);
  cipher.setAAD(aad(args));
  const ciphertext=Buffer.concat([cipher.update(args.value,"utf8"),cipher.final()]);
  return {
    algorithm:"aes-256-gcm" as const,
    ciphertext:ciphertext.toString("base64url"),
    iv:iv.toString("base64url"),
    authTag:cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptVaultValue(args:{
  ciphertext:string;
  iv:string;
  authTag:string;
  workspaceId:string;
  id:string;
  version:number;
  keyId:string;
  key:string;
}){
  const decipher=createDecipheriv(
    "aes-256-gcm",
    derivedKey(args.key),
    Buffer.from(args.iv,"base64url"),
  );
  decipher.setAAD(aad(args));
  decipher.setAuthTag(Buffer.from(args.authTag,"base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(args.ciphertext,"base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function metadataFromRow(row:VaultRow):VaultSecretMetadata{
  return VaultSecretMetadataSchema.parse({
    id:row.id,
    workspaceId:row.workspace_id,
    name:row.name,
    purpose:row.purpose,
    scopes:Array.isArray(row.scopes)?row.scopes:[],
    version:Number(row.version),
    keyId:row.key_id,
    algorithm:row.algorithm??"aes-256-gcm",
    createdBy:row.created_by,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  });
}

function restClient(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const headers={
    apikey:config.anonKey,
    Authorization:"Bearer "+config.anonKey,
    "Content-Type":"application/json",
  };
  async function request(path:string,init:RequestInit={}){
    const response=await fetch(root+"/"+path,{
      ...init,
      headers:{...headers,...(init.headers??{})},
    });
    if(!response.ok){
      const detail=await response.text().catch(()=>"");
      throw new Error("Server Vault HTTP "+response.status+": "+detail.slice(0,500));
    }
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  }
  return {request};
}

function requireVaultContext(){
  const workspaceId=getEvolutionWorkspaceId();
  const encryption=getVaultEncryptionConfig();
  if(!vaultEncryptionConfigured()||!workspaceId||!encryption){
    const error=new Error("Server Vault is not configured");
    Object.assign(error,{code:"VAULT_NOT_CONFIGURED"});
    throw error;
  }
  return {workspaceId,encryption};
}

export async function listVaultSecretMetadata(){
  const workspaceId=getEvolutionWorkspaceId();
  if(!vaultEncryptionConfigured()||!workspaceId){
    return VaultSecretListResponseSchema.parse({
      configured:false,
      workspaceId,
      secrets:[],
      message:"Server Vault 未配置。",
    });
  }
  const {request}=restClient();
  const rows=await request(
    "evolution_vault_secrets?select=workspace_id,id,name,purpose,scopes,version,key_id,algorithm,created_by,created_at,updated_at"
    +"&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&order=updated_at.desc",
  ) as VaultRow[];
  return VaultSecretListResponseSchema.parse({
    configured:true,
    workspaceId,
    secrets:(rows??[]).map(metadataFromRow),
    message:"Vault metadata loaded. Secret values are never returned.",
  });
}

export async function getVaultSecretMetadata(id:string){
  const {workspaceId}=requireVaultContext();
  const {request}=restClient();
  const rows=await request(
    "evolution_vault_secrets?select=workspace_id,id,name,purpose,scopes,version,key_id,algorithm,created_by,created_at,updated_at"
    +"&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&id=eq."+encodeURIComponent(id)
    +"&limit=1",
  ) as VaultRow[];
  return rows?.[0]?metadataFromRow(rows[0]):undefined;
}

export async function putVaultSecret(
  raw:VaultSecretPutRequest,
  actor:Pick<EvolutionActor,"id"|"role">,
  options?:{now?:string},
){
  const input=VaultSecretPutRequestSchema.parse(raw);
  const {workspaceId,encryption}=requireVaultContext();
  const {request}=restClient();
  const existingRows=await request(
    "evolution_vault_secrets?select=workspace_id,id,name,purpose,scopes,version,key_id,algorithm,created_by,created_at,updated_at"
    +"&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&id=eq."+encodeURIComponent(input.id)
    +"&limit=1",
  ) as VaultRow[];
  const existing=existingRows?.[0]?metadataFromRow(existingRows[0]):undefined;
  const version=(existing?.version??0)+1;
  const now=options?.now??new Date().toISOString();
  const encrypted=encryptVaultValue({
    value:input.value,
    workspaceId,
    id:input.id,
    version,
    keyId:encryption.keyId,
    key:encryption.activeKey,
  });
  const row={
    workspace_id:workspaceId,
    id:input.id,
    name:input.name,
    purpose:input.purpose,
    scopes:[...new Set(input.scopes)],
    version,
    key_id:encryption.keyId,
    algorithm:encrypted.algorithm,
    ciphertext:encrypted.ciphertext,
    iv:encrypted.iv,
    auth_tag:encrypted.authTag,
    created_by:existing?.createdBy??actor.id,
    created_at:existing?.createdAt??now,
    updated_at:now,
  };
  await request("evolution_vault_secrets?on_conflict=workspace_id,id",{
    method:"POST",
    headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify(row),
  });
  return VaultSecretPutResponseSchema.parse({
    metadata:metadataFromRow(row),
    message:existing
      ?"Vault secret rotated to version "+version+"."
      :"Vault secret encrypted and stored.",
  });
}

export async function resolveVaultSecret(id:string,requiredScope?:string){
  const {workspaceId,encryption}=requireVaultContext();
  const {request}=restClient();
  const rows=await request(
    "evolution_vault_secrets?select=*&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&id=eq."+encodeURIComponent(id)+"&limit=1",
  ) as VaultRow[];
  const row=rows?.[0];
  if(!row){
    const error=new Error("Vault secret not found: "+id);
    Object.assign(error,{code:"VAULT_SECRET_NOT_FOUND"});
    throw error;
  }
  const metadata=metadataFromRow(row);
  if(requiredScope&&metadata.scopes.length&&!metadata.scopes.includes(requiredScope)){
    const error=new Error("Vault secret "+id+" does not allow scope "+requiredScope);
    Object.assign(error,{code:"VAULT_SCOPE_DENIED"});
    throw error;
  }
  const key=encryption.decryptKeys[metadata.keyId];
  if(!key){
    const error=new Error("Vault decryption key is unavailable for keyId "+metadata.keyId);
    Object.assign(error,{code:"VAULT_KEY_UNAVAILABLE"});
    throw error;
  }
  if(
    typeof row.ciphertext!=="string"
    ||typeof row.iv!=="string"
    ||typeof row.auth_tag!=="string"
  ){
    throw new Error("Vault ciphertext row is invalid");
  }
  try{
    return decryptVaultValue({
      ciphertext:row.ciphertext,
      iv:row.iv,
      authTag:row.auth_tag,
      workspaceId,
      id:metadata.id,
      version:metadata.version,
      keyId:metadata.keyId,
      key,
    });
  }catch{
    const error=new Error("Vault secret authentication failed");
    Object.assign(error,{code:"VAULT_DECRYPT_FAILED"});
    throw error;
  }
}

export async function deleteVaultSecret(id:string){
  const {workspaceId}=requireVaultContext();
  const {request}=restClient();
  const rows=await request(
    "evolution_vault_secrets?workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&id=eq."+encodeURIComponent(id),
    {method:"DELETE",headers:{Prefer:"return=representation"}},
  ) as VaultRow[];
  return VaultSecretDeleteResponseSchema.parse({
    id,
    deleted:Boolean(rows?.length),
    message:rows?.length?"Vault secret deleted.":"Vault secret was not found.",
  });
}

export async function serverVaultHealth(){
  const workspaceId=getEvolutionWorkspaceId();
  const encryption=getVaultEncryptionConfig();
  if(!vaultEncryptionConfigured()||!workspaceId||!encryption){
    return {
      configured:false,
      databaseReady:false,
      keyRotationReady:Boolean(encryption&&Object.keys(encryption.decryptKeys).length>0),
      keyId:encryption?.keyId,
    };
  }
  try{
    const {request}=restClient();
    await request("evolution_vault_secrets?select=id&limit=1");
    return {
      configured:true,
      databaseReady:true,
      keyRotationReady:Object.keys(encryption.decryptKeys).length>0,
      keyId:encryption.keyId,
    };
  }catch{
    return {
      configured:true,
      databaseReady:false,
      keyRotationReady:Object.keys(encryption.decryptKeys).length>0,
      keyId:encryption.keyId,
    };
  }
}
