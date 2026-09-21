// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {
  decryptVaultValue,
  deleteVaultSecret,
  encryptVaultValue,
  listVaultSecretMetadata,
  putVaultSecret,
  resolveVaultSecret,
  serverVaultHealth,
} from "./server-vault";

const KEYS=[
  "NODE_ENV","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY","EVOLUTION_WORKSPACE_ID",
  "EVOLUTION_VAULT_MASTER_KEY","EVOLUTION_VAULT_KEY_ID","EVOLUTION_VAULT_DECRYPT_KEYS_JSON",
] as const;
const previous=new Map<string,string|undefined>();

type Row=Record<string,unknown>;

function installVaultDb(){
  const rows=new Map<string,Row>();
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    const method=init?.method??"GET";
    const id=(url.searchParams.get("id")??"").replace(/^eq\./,"");
    const workspace=(url.searchParams.get("workspace_id")??"").replace(/^eq\./,"");
    const selected=[...rows.values()].filter((row)=>{
      if(id&&row.id!==id)return false;
      if(workspace&&row.workspace_id!==workspace)return false;
      return true;
    });
    if(method==="POST"){
      const row=JSON.parse(String(init?.body)) as Row;
      rows.set(String(row.id),row);
      return new Response(null,{status:204});
    }
    if(method==="DELETE"){
      const deleted=[...selected];
      for(const row of deleted)rows.delete(String(row.id));
      return new Response(JSON.stringify(deleted),{status:200,headers:{"Content-Type":"application/json"}});
    }
    return new Response(JSON.stringify(selected),{status:200,headers:{"Content-Type":"application/json"}});
  });
  vi.stubGlobal("fetch",fetchMock);
  return {rows,fetchMock};
}

describe("AES-GCM Server Vault",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    process.env.NODE_ENV="test";
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
    process.env.EVOLUTION_VAULT_MASTER_KEY="a".repeat(64);
    process.env.EVOLUTION_VAULT_KEY_ID="vault-key-v1";
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("authenticates ciphertext, AAD and tag so tampering fails closed",()=>{
    const encrypted=encryptVaultValue({
      value:"super-secret",
      workspaceId:"workspace-test",
      id:"connector-token",
      version:1,
      keyId:"vault-key-v1",
      key:"a".repeat(64),
    });
    expect(decryptVaultValue({
      ...encrypted,
      authTag:encrypted.authTag,
      workspaceId:"workspace-test",
      id:"connector-token",
      version:1,
      keyId:"vault-key-v1",
      key:"a".repeat(64),
    })).toBe("super-secret");
    const tampered=encrypted.ciphertext.slice(0,-1)+(encrypted.ciphertext.endsWith("A")?"B":"A");
    expect(()=>decryptVaultValue({
      ...encrypted,
      ciphertext:tampered,
      authTag:encrypted.authTag,
      workspaceId:"workspace-test",
      id:"connector-token",
      version:1,
      keyId:"vault-key-v1",
      key:"a".repeat(64),
    })).toThrow();
    expect(()=>decryptVaultValue({
      ...encrypted,
      authTag:encrypted.authTag,
      workspaceId:"workspace-test",
      id:"different-id",
      version:1,
      keyId:"vault-key-v1",
      key:"a".repeat(64),
    })).toThrow();
  });

  it("stores only ciphertext and returns metadata without plaintext",async()=>{
    const {rows}=installVaultDb();
    const result=await putVaultSecret({
      id:"connector-token",
      name:"Connector Token",
      purpose:"Test connector auth",
      scopes:["connector:test-connector:credential"],
      value:"plain-secret-value",
    },{id:"admin-1",role:"admin"},{now:"2026-09-21T05:00:00.000Z"});
    expect(result.metadata).toMatchObject({
      id:"connector-token",
      version:1,
      keyId:"vault-key-v1",
      algorithm:"aes-256-gcm",
      createdBy:"admin-1",
    });
    expect(JSON.stringify(result)).not.toContain("plain-secret-value");
    const row=rows.get("connector-token")!;
    expect(row.ciphertext).not.toBe("plain-secret-value");
    expect(row).not.toHaveProperty("value");
    await expect(resolveVaultSecret("connector-token","connector:test-connector:credential"))
      .resolves.toBe("plain-secret-value");
    const list=await listVaultSecretMetadata();
    expect(list.secrets).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("plain-secret-value");
  });

  it("decrypts old key versions after rotation and re-encrypts updates with the active key",async()=>{
    const {rows}=installVaultDb();
    await putVaultSecret({
      id:"rotating-secret",
      name:"Rotating",
      purpose:"Rotation test",
      scopes:[],
      value:"version-one",
    },{id:"admin-1",role:"admin"},{now:"2026-09-21T05:00:00.000Z"});
    process.env.EVOLUTION_VAULT_MASTER_KEY="b".repeat(64);
    process.env.EVOLUTION_VAULT_KEY_ID="vault-key-v2";
    process.env.EVOLUTION_VAULT_DECRYPT_KEYS_JSON=JSON.stringify({
      "vault-key-v1":"a".repeat(64),
    });
    await expect(resolveVaultSecret("rotating-secret")).resolves.toBe("version-one");
    const updated=await putVaultSecret({
      id:"rotating-secret",
      name:"Rotating",
      purpose:"Rotation test",
      scopes:[],
      value:"version-two",
    },{id:"admin-2",role:"admin"},{now:"2026-09-21T05:05:00.000Z"});
    expect(updated.metadata).toMatchObject({version:2,keyId:"vault-key-v2",createdBy:"admin-1"});
    expect(rows.get("rotating-secret")?.key_id).toBe("vault-key-v2");
    await expect(resolveVaultSecret("rotating-secret")).resolves.toBe("version-two");
  });

  it("enforces declared scopes but keeps empty scope lists server-unrestricted",async()=>{
    installVaultDb();
    await putVaultSecret({
      id:"scoped",
      name:"Scoped",
      purpose:"Scope test",
      scopes:["connector:a:credential"],
      value:"scope-secret",
    },{id:"admin-1",role:"admin"});
    await expect(resolveVaultSecret("scoped","connector:a:credential")).resolves.toBe("scope-secret");
    await expect(resolveVaultSecret("scoped","connector:b:credential")).rejects.toMatchObject({code:"VAULT_SCOPE_DENIED"});
    await putVaultSecret({
      id:"unscoped",
      name:"Unscoped",
      purpose:"Scope test",
      scopes:[],
      value:"general-secret",
    },{id:"admin-1",role:"admin"});
    await expect(resolveVaultSecret("unscoped","connector:any:webhook")).resolves.toBe("general-secret");
  });

  it("deletes encrypted rows and reports health without exposing key material",async()=>{
    const {rows}=installVaultDb();
    await putVaultSecret({
      id:"delete-me",name:"Delete",purpose:"Delete test",scopes:[],value:"secret",
    },{id:"admin-1",role:"admin"});
    await expect(serverVaultHealth()).resolves.toMatchObject({
      configured:true,databaseReady:true,keyRotationReady:true,keyId:"vault-key-v1",
    });
    expect(await deleteVaultSecret("delete-me")).toMatchObject({id:"delete-me",deleted:true});
    expect(rows.has("delete-me")).toBe(false);
  });
});
