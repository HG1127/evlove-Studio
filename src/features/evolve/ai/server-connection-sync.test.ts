import {afterEach,describe,expect,it,vi} from "vitest";
import {buildServerAiConnectionInput,getGenerationConnectionDisplay,synchronizeGenerationConnection} from "./server-connection-sync";
import type {ProviderConnection} from "./providers/registry";
import type {ServerAiConnectionSettings,ServerAiConnectionStatus} from "@evolution/contracts";

const connection=(patch:Partial<ProviderConnection>={}):ProviderConnection=>({
  id:"minimax-primary",providerId:"custom",label:"MiniMax 主力",enabled:true,
  apiKey:"synthetic-secret",baseUrl:"https://api.minimaxi.com/v1/chat/completions",
  defaultModel:"MiniMax-M2.7-highspeed",models:["MiniMax-M2.7-highspeed"],
  createdAt:"2026-01-01",updatedAt:"2026-01-01",...patch,
});
const settings=(patch:Partial<ServerAiConnectionSettings>={}):ServerAiConnectionSettings=>({
  connectionId:"minimax-primary",label:"MiniMax 主力",baseUrl:"https://api.minimaxi.com/v1",
  model:"MiniMax-M2.7-highspeed",protocol:"chat-completions",responseFormat:"prompt-json",...patch,
});
const status=(patch:Partial<ServerAiConnectionStatus>={}):ServerAiConnectionStatus=>({
  storageConfigured:true,configured:true,revision:9,message:"saved",connection:settings(),...patch,
});
const ports=()=>({read:vi.fn().mockResolvedValue(status()),save:vi.fn().mockResolvedValue(status({revision:10}))});
afterEach(()=>vi.unstubAllGlobals());

describe("unified connection settings preservation",()=>{
  it("maps a new OpenAI-compatible connection without a provider-specific override",()=>{
    expect(buildServerAiConnectionInput(connection())).toEqual({...settings({responseFormat:"json-object"}),apiKey:"synthetic-secret"});
  });
  it.each(["prompt-json","json-object","json-schema"] as const)("preserves saved response format %s for the exact current target",format=>{
    expect(buildServerAiConnectionInput(connection(),settings({responseFormat:format})).responseFormat).toBe(format);
  });
  it("preserves an explicit Responses protocol instead of replacing it with the preset",()=>{
    expect(buildServerAiConnectionInput(connection(),settings({protocol:"responses"})).protocol).toBe("responses");
  });
  it("normalizes URL suffixes and permits a label edit without losing compatibility settings",()=>{
    const input=buildServerAiConnectionInput(connection({label:"Renamed"}),settings());
    expect(input.label).toBe("Renamed");expect(input.responseFormat).toBe("prompt-json");
  });
  it.each([
    {connectionId:"another-connection"},{baseUrl:"https://another.test/v1"},{model:"another-model"},
  ])("does not inherit protocol/format from a different target %j",patch=>{
    expect(buildServerAiConnectionInput(connection(),settings({...patch,protocol:"responses"})).responseFormat).toBe("json-object");
  });
  it.each([{apiKey:" "},{defaultModel:" "},{providerId:"anthropic"},{enabled:false}])("rejects an unusable connection %j",patch=>{
    expect(()=>buildServerAiConnectionInput(connection(patch))).toThrow();
  });
});

describe("single generation save orchestration",()=>{
  it("reads fresh generation metadata before a single write and retains prompt-json",async()=>{
    const p=ports();const saved=await synchronizeGenerationConnection(connection(),{},p);
    expect(p.read).toHaveBeenCalledWith("generation");
    expect(p.save).toHaveBeenCalledWith(expect.objectContaining({responseFormat:"prompt-json",protocol:"chat-completions"}),"generation");
    expect(p.save).toHaveBeenCalledOnce();expect(saved.revision).toBe(10);
    expect(JSON.stringify(saved).includes("synthetic-secret")).toBe(false);
  });
  it("does not write when the fresh read fails",async()=>{
    const p=ports();p.read.mockRejectedValue(new Error("synthetic-secret upstream error"));
    await expect(synchronizeGenerationConnection(connection(),{},p)).rejects.toThrow("无法读取");
    expect(p.save).toHaveBeenCalledTimes(0);
  });
  it("does not write when Vault is not configured",async()=>{
    const p=ports();p.read.mockResolvedValue(status({storageConfigured:false,configured:false,connection:undefined}));
    await expect(synchronizeGenerationConnection(connection(),{},p)).rejects.toThrow("加密存储");expect(p.save).toHaveBeenCalledTimes(0);
  });
  it("rejects an incomplete configured status rather than choosing fresh defaults",async()=>{
    const p=ports();p.read.mockResolvedValue(status({connection:undefined}));
    await expect(synchronizeGenerationConnection(connection(),{},p)).rejects.toThrow("不完整");expect(p.save).toHaveBeenCalledTimes(0);
  });
  it("requires explicit confirmation before replacing a different backend target",async()=>{
    const p=ports();p.read.mockResolvedValue(status({connection:settings({model:"old-model"})}));
    await expect(synchronizeGenerationConnection(connection(),{},p)).rejects.toThrow("未确认切换");expect(p.save).toHaveBeenCalledTimes(0);
  });
  it("passes only public metadata to replacement confirmation and respects a refusal",async()=>{
    const p=ports();p.read.mockResolvedValue(status({connection:settings({connectionId:"old"})}));
    const confirmReplacement=vi.fn().mockResolvedValue(false);
    await expect(synchronizeGenerationConnection(connection(),{confirmReplacement},p)).rejects.toThrow("未确认切换");
    expect(p.save).toHaveBeenCalledTimes(0);expect(JSON.stringify(confirmReplacement.mock.calls).includes("synthetic-secret")).toBe(false);
  });
  it("permits an explicitly confirmed target change without touching Judge",async()=>{
    const p=ports();p.read.mockResolvedValue(status({connection:settings({connectionId:"old"})}));
    p.save.mockResolvedValue(status({revision:10,connection:settings({responseFormat:"json-object"})}));
    await synchronizeGenerationConnection(connection(),{confirmReplacement:()=>true},p);
    expect(p.save).toHaveBeenCalledOnce();expect(p.save.mock.calls[0][1]).toBe("generation");
  });
  it("allows a first save only after confirming that the server is unconfigured",async()=>{
    const p=ports();p.read.mockResolvedValue(status({configured:false,connection:undefined,revision:undefined}));
    p.save.mockResolvedValue(status({revision:1,connection:settings({responseFormat:"json-object"})}));
    expect((await synchronizeGenerationConnection(connection(),{},p)).revision).toBe(1);
  });
  it("fails closed on a mismatched save result",async()=>{
    const p=ports();p.save.mockResolvedValue(status({revision:10,connection:settings({responseFormat:"json-object"})}));
    await expect(synchronizeGenerationConnection(connection(),{},p)).rejects.toThrow("不一致");
  });
  it("does not replay an ambiguous write or expose raw credential-bearing errors",async()=>{
    const p=ports();p.save.mockRejectedValue(new Error("synthetic-secret readback failed"));
    let message="";try{await synchronizeGenerationConnection(connection(),{},p);}catch(error){message=String(error);}
    expect(message).toContain("未确认");expect(message.includes("synthetic-secret")).toBe(false);expect(p.save).toHaveBeenCalledOnce();
  });
  it("uses GET, PUT, GET on the generation endpoint with the stored prompt-json value",async()=>{
    const reply=(value:unknown)=>new Response(JSON.stringify(value),{status:200});
    const fetch=vi.fn().mockResolvedValueOnce(reply(status())).mockResolvedValueOnce(reply(status({revision:10}))).mockResolvedValueOnce(reply(status({revision:10})));
    vi.stubGlobal("fetch",fetch);
    await synchronizeGenerationConnection(connection());
    expect(fetch.mock.calls.map(call=>call[0])).toEqual(Array(3).fill("/api/evolution/ai-connection"));
    expect(fetch.mock.calls.map(call=>call[1]?.method??"GET")).toEqual(["GET","PUT","GET"]);
    expect(JSON.parse(fetch.mock.calls[1][1].body).responseFormat).toBe("prompt-json");
  });
});

describe("truthful generation connection display",()=>{
  it("prioritizes sync errors over an old configured receipt",()=>{
    expect(getGenerationConnectionDisplay(connection(),status(),{error:"read failed"}).state).toBe("error");
  });
  it("does not label a different selection as synchronized",()=>{
    expect(getGenerationConnectionDisplay(connection({id:"other"}),status()).state).toBe("different");
  });
  it("does not label edited or key-dirty metadata as synchronized",()=>{
    expect(getGenerationConnectionDisplay(connection({label:"Edited"}),status()).state).toBe("changed");
    expect(getGenerationConnectionDisplay(connection(),status(),{dirty:true}).state).toBe("changed");
  });
  it("distinguishes unknown state, Vault unavailability, first save, and active save",()=>{
    expect(getGenerationConnectionDisplay(connection(),undefined).state).toBe("loading");
    expect(getGenerationConnectionDisplay(connection(),status({storageConfigured:false})).state).toBe("unavailable");
    expect(getGenerationConnectionDisplay(connection(),status({configured:false,connection:undefined})).state).toBe("unconfigured");
    expect(getGenerationConnectionDisplay(connection(),status(),{saving:true}).state).toBe("saving");
  });
  it("reports matching metadata without claiming a fresh health call",()=>{
    const view=getGenerationConnectionDisplay(connection(),status());expect(view.state).toBe("matched");
    expect(view.message).toContain("prompt-json");expect(view.message).toContain("非实时连通性");
  });
});