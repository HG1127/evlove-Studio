// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {
  readCurrentPinnedServerAiPublicSelection,readCurrentStoredServerAiPublicSelection,
  resolveServerAiConfig,saveServerAiConnection,withExplicitServerAiConnection,withServerAiConnection,
} from "./server-ai-connection";
import {readCurrentServerAiScoringSelection,serverAiPublicScoringRouteFingerprint,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {encryptVaultValue,getVaultSecretRecordIdentity,resolveVaultSecretWithMetadata} from "./server-vault";
import {ServerAiPublicSelectionSchema,serverAiPublicSelectionIdentity,serverAiPublicSelectionRoute} from "./server-ai-public-selection";

const storedId="server-ai-default-connection-v1";
const master="synthetic-vault-master-".repeat(4);
const input={connectionId:"mine",label:"My model",baseUrl:"https://models.example.test/v1",model:"my-model",
  apiKey:"synthetic-private-provider-key",protocol:"chat-completions" as const,responseFormat:"json-object" as const};
const keys=["NODE_ENV","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY",
  "EVOLUTION_WORKSPACE_ID","EVOLUTION_VAULT_MASTER_KEY","EVOLUTION_VAULT_KEY_ID","EVOLUTION_VAULT_DECRYPT_KEYS_JSON",
  "EVOLUTION_AI_API_KEY","OPENAI_API_KEY","EVOLUTION_AI_MODEL","OPENAI_MODEL","EVOLUTION_AI_BASE_URL","OPENAI_BASE_URL",
  "VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED"] as const;
const previous=new Map<string,string|undefined>();
let rows:Map<string,Record<string,unknown>>;
let reads:string[];
let replaceAfterResolve:(()=>void)|undefined;

beforeEach(()=>{
  for(const key of keys){previous.set(key,process.env[key]);delete process.env[key];}
  Object.assign(process.env,{NODE_ENV:"test",SUPABASE_URL:"https://supabase.test",SUPABASE_PUBLISHABLE_KEY:"anon-synthetic-key-1234567890",
    EVOLUTION_WORKSPACE_ID:"workspace-test",EVOLUTION_VAULT_MASTER_KEY:master,EVOLUTION_VAULT_KEY_ID:"test-key"});
  rows=new Map();reads=[];replaceAfterResolve=undefined;
  vi.stubGlobal("fetch",vi.fn(async(raw:RequestInfo|URL,init:RequestInit={})=>{
    const url=new URL(String(raw));
    expect(url.hostname).toBe("supabase.test");
    expect(url.pathname).toBe("/rest/v1/evolution_vault_secrets");
    if(init.method==="POST"){
      const row=JSON.parse(String(init.body));rows.set(String(row.id),row);
      return new Response(null,{status:204});
    }
    expect(init.method??"GET").toBe("GET");
    const select=url.searchParams.get("select")!;reads.push(select);
    const columns=select.split(",");
    const result=[...rows.values()].map(row=>select==="*"?row:Object.fromEntries(columns.map(name=>[name,row[name]])));
    const response=new Response(JSON.stringify(result),{status:200});
    if(select==="*"&&replaceAfterResolve){const replace=replaceAfterResolve;replaceAfterResolve=undefined;replace();}
    return response;
  }));
});
afterEach(()=>{
  vi.unstubAllGlobals();
  for(const key of keys){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
async function seed(){await saveServerAiConnection(input,{id:"admin",role:"admin"});reads=[];}

describe("actual default Vault selection independently of pinned execution",()=>{
  it("binds the same authenticated row, reads fresh identities, and returns no private bytes",async()=>{
    await seed();
    await withServerAiConnection(async()=>{
      const first=await readCurrentServerAiScoringSelection();
      expect(first.availability).toBe("available");
      if(first.availability!=="available")throw new Error("Expected public selection");
      expect(first.scoringRouteFingerprint).toBe(await serverAiScoringRouteFingerprint());
      expect(first.scoringRouteFingerprint).toBe(serverAiPublicScoringRouteFingerprint(serverAiPublicSelectionRoute(first.selection)));
      expect(first.selection.metadata.version).toBe(1);
      expect(first.selectionIdentitySha256).toBe(serverAiPublicSelectionIdentity(first.selection));
      expect(JSON.stringify(first)).not.toContain(input.apiKey);
      expect(first.selection).not.toHaveProperty("ciphertext");
      expect(first.selection.settings).not.toHaveProperty("apiKey");
      delete process.env.EVOLUTION_VAULT_MASTER_KEY;
      expect(await readCurrentPinnedServerAiPublicSelection()).toMatchObject({availability:"available",selectionIdentitySha256:first.selectionIdentitySha256});
      expect((await resolveServerAiConfig())?.model).toBe(input.model);
      expect(reads.filter(select=>select==="*")).toHaveLength(1);
      expect(reads.filter(select=>select.includes("ciphertext")&&select!=="*")).toHaveLength(2);
    });
    expect(await readCurrentPinnedServerAiPublicSelection()).toEqual({availability:"unavailable",reason:"public-selection-unbound"});
  });

  it.each([
    {connectionId:"other"},{label:"Changed label"},{baseUrl:"https://other.example.test/v2"},{model:"other-model"},
    {protocol:"responses" as const},{responseFormat:"prompt-json" as const},{apiKey:"synthetic-key-only-rotation"},
  ])("refuses a stored selection change while execution stays pinned: %j",async(change)=>{
    await seed();
    await withServerAiConnection(async()=>{
      const before=await readCurrentServerAiScoringSelection();
      expect(before.availability).toBe("available");
      const pinned=await resolveServerAiConfig();
      await saveServerAiConnection({...input,...change},{id:"admin",role:"admin"});
      expect(await resolveServerAiConfig()).toEqual(pinned);
      expect(await readCurrentServerAiScoringSelection()).toEqual({availability:"unavailable",reason:"public-selection-metadata-drift"});
      expect(reads.filter(select=>select==="*")).toHaveLength(1);
    });
  });

  it("detects replacement with identical revision and timestamps from fresh sealed bytes",async()=>{
    await seed();
    await withServerAiConnection(async()=>{
      const before=await readCurrentPinnedServerAiPublicSelection();
      expect(before.availability).toBe("available");
      const row=rows.get(storedId)!;
      const sealed=encryptVaultValue({value:JSON.stringify({...input,model:"same-revision-replacement",version:"server-ai-connection-v1"}),
        workspaceId:"workspace-test",id:storedId,version:1,keyId:"test-key",key:master});
      rows.set(storedId,{...row,ciphertext:sealed.ciphertext,iv:sealed.iv,auth_tag:sealed.authTag});
      expect(await readCurrentPinnedServerAiPublicSelection()).toEqual({availability:"unavailable",reason:"public-selection-metadata-drift"});
      expect((await resolveServerAiConfig())?.model).toBe(input.model);
    });
  });

  it("keeps row and JSON property order irrelevant to the stored identity",async()=>{
    await seed();
    await withServerAiConnection(async()=>{
      const before=await readCurrentPinnedServerAiPublicSelection();
      if(before.availability!=="available")throw new Error("Expected public selection");
      rows.set(storedId,Object.fromEntries(Object.entries(rows.get(storedId)!).reverse()));
      expect(await readCurrentStoredServerAiPublicSelection(JSON.parse(JSON.stringify(before.selection))))
        .toMatchObject({availability:"available",selectionIdentitySha256:before.selectionIdentitySha256});
    });
  });

  it("does not run a synchronous callback twice when it throws a missing-secret error",async()=>{
    await seed();
    process.env.EVOLUTION_AI_API_KEY="synthetic-environment-key";process.env.EVOLUTION_AI_MODEL="another-model";
    const error=Object.assign(new Error("Synthetic callback failure"),{code:"VAULT_SECRET_NOT_FOUND"});
    const work=vi.fn(()=>{throw error;});
    await expect(withServerAiConnection(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledOnce();
    expect(reads.filter(select=>select==="*")).toHaveLength(1);
  });

  it("catches a save between authenticated resolve and the first independent read",async()=>{
    await seed();
    replaceAfterResolve=()=>{const row=rows.get(storedId)!;rows.set(storedId,{...row,version:2});};
    await withServerAiConnection(async()=>{
      expect((await resolveServerAiConfig())?.model).toBe(input.model);
      expect(await readCurrentPinnedServerAiPublicSelection()).toEqual({availability:"unavailable",reason:"public-selection-metadata-drift"});
    });
  });

  it("keeps a deleted/malformed record or a workspace change unavailable without decrypting again",async()=>{
    await seed();
    await withServerAiConnection(async()=>{
      const first=await readCurrentPinnedServerAiPublicSelection();
      if(first.availability!=="available")throw new Error("Expected public selection");
      const row=rows.get(storedId)!;
      rows.delete(storedId);
      expect(await readCurrentStoredServerAiPublicSelection(first.selection)).toMatchObject({availability:"unavailable",reason:"public-selection-metadata-unavailable"});
      rows.set(storedId,{...row,version:Number.MAX_SAFE_INTEGER+1});
      expect(await readCurrentPinnedServerAiPublicSelection()).toMatchObject({availability:"unavailable",reason:"public-selection-metadata-unavailable"});
      rows.set(storedId,row);process.env.EVOLUTION_WORKSPACE_ID="another-workspace";
      expect(await readCurrentPinnedServerAiPublicSelection()).toMatchObject({availability:"unavailable",reason:"public-selection-workspace-drift"});
      expect(reads.filter(select=>select==="*")).toHaveLength(1);
    });
  });

  it("rechecks a serialized signed-context selection instead of refreshing its captured version",async()=>{
    await seed();
    let captured:unknown;
    await withServerAiConnection(async()=>{
      const first=await readCurrentPinnedServerAiPublicSelection();
      if(first.availability!=="available")throw new Error("Expected public selection");
      captured=JSON.parse(JSON.stringify(first.selection));
    });
    expect(await readCurrentStoredServerAiPublicSelection(captured)).toMatchObject({availability:"available"});
    await saveServerAiConnection({...input,apiKey:"another-synthetic-key"},{id:"admin",role:"admin"});
    expect(await readCurrentStoredServerAiPublicSelection(captured)).toMatchObject({availability:"unavailable",reason:"public-selection-metadata-drift"});
    expect(reads.filter(select=>select==="*")).toHaveLength(1);
  });

  it("returns a capability gap for an unversioned environment or unsaved explicit route",async()=>{
    delete process.env.EVOLUTION_VAULT_MASTER_KEY;
    process.env.EVOLUTION_AI_API_KEY="synthetic-environment-key";process.env.EVOLUTION_AI_MODEL="environment-model";
    await withServerAiConnection(async()=>{
      expect(await readCurrentServerAiScoringSelection()).toEqual({availability:"unavailable",reason:"environment-credential-epoch-unavailable"});
      process.env.EVOLUTION_AI_MODEL="changed-env-model";
      expect((await resolveServerAiConfig())?.model).toBe("environment-model");
    });
    await withExplicitServerAiConnection(input,async()=>expect(await readCurrentPinnedServerAiPublicSelection()).toMatchObject({availability:"unavailable"}));
    expect(reads).toEqual([]);
  });

  it("validates public boundaries and never turns malformed secret input into diagnostic text",async()=>{
    await seed();
    const record=await resolveVaultSecretWithMetadata(storedId,"ai:default-connection");
    const identity=await getVaultSecretRecordIdentity(storedId);
    expect(identity).toEqual({metadata:record.metadata,sealedRecordSha256:record.sealedRecordSha256});
    expect(JSON.stringify(identity)).not.toContain(record.value);
    expect(ServerAiPublicSelectionSchema.safeParse({settings:input}).success).toBe(false);
    const result=await readCurrentStoredServerAiPublicSelection({apiKey:input.apiKey});
    expect(result).toEqual({availability:"unavailable",reason:"public-selection-invalid"});
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
  });

  it("rejects foreign physical rows on both authenticated resolve and fresh identity reads",async()=>{
    await seed();
    rows.set(storedId,{...rows.get(storedId)!,workspace_id:"foreign-workspace"});
    await expect(resolveVaultSecretWithMetadata(storedId,"ai:default-connection")).rejects.toMatchObject({code:"VAULT_IDENTITY_MISMATCH"});
    await expect(getVaultSecretRecordIdentity(storedId)).rejects.toMatchObject({code:"VAULT_IDENTITY_MISMATCH"});
  });
});
