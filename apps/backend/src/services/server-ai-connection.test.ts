// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const vault=vi.hoisted(()=>({
  configured:vi.fn(),metadata:vi.fn(),put:vi.fn(),resolve:vi.fn(),
}));
vi.mock("../server-env",async(original)=>({
  ...await original<typeof import("../server-env")>(),vaultEncryptionConfigured:vault.configured,
}));
vi.mock("./server-vault",()=>({
  getVaultSecretMetadata:vault.metadata,putVaultSecret:vault.put,resolveVaultSecret:vault.resolve,
}));
import {
  getServerAiConnectionStatus,resolveServerAiConfig,saveServerAiConnection,
  withExplicitServerAiConnection,withServerAiConnection,
} from "./server-ai-connection";

const input={
  connectionId:"custom-a",label:"我的自定义模型",baseUrl:"https://models.example.test/v1/chat/completions/",
  model:"arbitrary-model-id",apiKey:"private-key-never-return",
  protocol:"chat-completions" as const,responseFormat:"json-object" as const,
};
const keys=["NODE_ENV","EVOLUTION_AI_API_KEY","OPENAI_API_KEY","EVOLUTION_AI_MODEL","OPENAI_MODEL","EVOLUTION_AI_BASE_URL","VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED","EVOLUTION_AI_TIMEOUT_MS","OPENAI_TIMEOUT_MS","EVOLUTION_AI_REASONING_EFFORT"];
const previous=new Map<string,string|undefined>();
beforeEach(()=>{
  for(const key of keys){previous.set(key,process.env[key]);delete process.env[key];}
  vault.configured.mockReset().mockReturnValue(true);
  vault.metadata.mockReset().mockResolvedValue(undefined);
  vault.put.mockReset().mockResolvedValue({metadata:{version:3}});
  vault.resolve.mockReset().mockRejectedValue(Object.assign(new Error("missing"),{code:"VAULT_SECRET_NOT_FOUND"}));
});
afterEach(()=>{
  for(const key of keys){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

describe("user-selected backend AI connection",()=>{
  it("pins the explicit server reasoning effort for a saved Vault connection",async()=>{
    process.env.EVOLUTION_AI_REASONING_EFFORT="medium";
    vault.resolve.mockResolvedValue(JSON.stringify({...input,version:"server-ai-connection-v1"}));
    expect(await resolveServerAiConfig()).toMatchObject({reasoningEffort:"medium",model:input.model});
    await withServerAiConnection(async()=>{
      process.env.EVOLUTION_AI_REASONING_EFFORT="low";
      expect(await resolveServerAiConfig()).toMatchObject({reasoningEffort:"medium"});
    });
    expect(await resolveServerAiConfig()).toMatchObject({reasoningEffort:"low"});
  });
  it("honors the configured provider timeout for a Vault connection without an environment API key",async()=>{
    process.env.EVOLUTION_AI_TIMEOUT_MS="180000";
    vault.resolve.mockResolvedValue(JSON.stringify({...input,version:"server-ai-connection-v1"}));
    expect(await resolveServerAiConfig()).toMatchObject({timeoutMs:180_000,model:input.model});
    await withExplicitServerAiConnection(input,async()=>expect(await resolveServerAiConfig()).toMatchObject({timeoutMs:180_000}));
  });
  it("encrypts a complete versioned connection through the existing Vault and returns no API key",async()=>{
    const result=await saveServerAiConnection(input,{id:"admin",role:"admin"});
    expect(result).toMatchObject({storageConfigured:true,configured:true,revision:3,connection:{
      baseUrl:"https://models.example.test/v1",model:"arbitrary-model-id",connectionId:"custom-a",
    }});
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
    expect(result.connection).not.toHaveProperty("apiKey");
    const stored=vault.put.mock.calls[0]?.[0];
    expect(stored.scopes).toEqual(["ai:default-connection"]);
    expect(JSON.parse(stored.value)).toMatchObject({
      version:"server-ai-connection-v1",baseUrl:"https://models.example.test/v1",apiKey:input.apiKey,
    });
  });

  it("loads saved route metadata without returning secret fields",async()=>{
    vault.metadata.mockResolvedValue({version:4});
    vault.resolve.mockResolvedValue(JSON.stringify({...input,version:"server-ai-connection-v1"}));
    const result=await getServerAiConnectionStatus();
    expect(result.connection?.model).toBe(input.model);
    expect(result.revision).toBe(4);
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
    expect(vault.resolve).toHaveBeenCalledWith("server-ai-default-connection-v1","ai:default-connection");
  });

  it("uses a saved user connection before any Gateway or environment defaults",async()=>{
    process.env.VERCEL="1";
    process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";
    process.env.EVOLUTION_AI_API_KEY="environment-key";
    process.env.EVOLUTION_AI_MODEL="environment-model";
    vault.resolve.mockResolvedValue(JSON.stringify({...input,version:"server-ai-connection-v1"}));
    expect(await resolveServerAiConfig()).toMatchObject({
      mode:"openai-compatible",apiKey:input.apiKey,model:input.model,protocol:"chat-completions",
    });
  });

  it("keeps a single route pinned for a complete evaluation despite saved connection changes",async()=>{
    vault.resolve.mockResolvedValueOnce(JSON.stringify({...input,version:"server-ai-connection-v1"}))
      .mockResolvedValue(JSON.stringify({...input,model:"changed",version:"server-ai-connection-v1"}));
    await withServerAiConnection(async()=>{
      expect((await resolveServerAiConfig())?.model).toBe(input.model);
      await withServerAiConnection(async()=>expect((await resolveServerAiConfig())?.model).toBe(input.model));
    });
    expect(vault.resolve).toHaveBeenCalledTimes(1);
    expect((await resolveServerAiConfig())?.model).toBe("changed");
  });

  it("isolates concurrent explicit test connections without changing the stored default",async()=>{
    const models=await Promise.all(["one","two"].map((model)=>withExplicitServerAiConnection({...input,model},async()=>{
      await Promise.resolve();
      return (await resolveServerAiConfig())?.model;
    })));
    expect(models).toEqual(["one","two"]);
    expect(vault.put).not.toHaveBeenCalled();
    expect(vault.resolve).not.toHaveBeenCalled();
  });

  it("uses environment direct credentials when no saved connection exists",async()=>{
    process.env.EVOLUTION_AI_API_KEY="environment-key";
    process.env.EVOLUTION_AI_MODEL="environment-model";
    expect(await resolveServerAiConfig()).toMatchObject({mode:"openai-compatible",model:"environment-model"});
  });

  it("does not silently fall back to Gateway when Vault is unavailable or corrupt",async()=>{
    process.env.VERCEL="1";
    process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";
    vault.resolve.mockRejectedValueOnce(new Error("Vault offline"));
    await expect(resolveServerAiConfig()).rejects.toThrow("Vault offline");
    vault.resolve.mockResolvedValueOnce(JSON.stringify({...input,version:"unknown-version"}));
    await expect(resolveServerAiConfig()).rejects.toThrow();
  });

  it.each(["private-key-never-return",JSON.stringify({...input,version:"invalid"})])("does not expose decrypted content in malformed connection errors",async(raw)=>{
    vault.metadata.mockResolvedValue({version:1});
    vault.resolve.mockResolvedValue(raw);
    for(const read of [getServerAiConnectionStatus,resolveServerAiConfig]){
      const error=await read().catch((value:unknown)=>value);
      expect(error).toMatchObject({code:"SERVER_AI_CONNECTION_INVALID"});
      expect((error as Error).message).toContain("配置无效");
      expect((error as Error).message).not.toContain("private-key");
    }
  });

  it("reports unavailable storage without attempting Vault I/O",async()=>{
    vault.configured.mockReturnValue(false);
    expect(await getServerAiConnectionStatus()).toMatchObject({storageConfigured:false,configured:false});
    expect(vault.metadata).not.toHaveBeenCalled();
    expect(vault.resolve).not.toHaveBeenCalled();
  });

  it("requires HTTPS in production before storage or an explicit probe",async()=>{
    process.env.NODE_ENV="production";
    const insecure={...input,baseUrl:"http://models.example.test/v1"};
    await expect(saveServerAiConnection(insecure,{id:"admin",role:"admin"})).rejects.toThrow("HTTPS");
    expect(()=>withExplicitServerAiConnection(insecure,async()=>{})).toThrow("HTTPS");
    expect(vault.put).not.toHaveBeenCalled();
  });
});
