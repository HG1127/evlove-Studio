// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {saveServerAiConnection} from "./server-connection-client";

const input={connectionId:"connection",label:"Custom",apiKey:"synthetic-secret",model:"selected-model",baseUrl:"https://provider.test/v1/chat/completions/",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
const saved={configured:true,storageConfigured:true,revision:4,message:"saved",connection:{...input,baseUrl:"https://provider.test/v1"}};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
afterEach(()=>vi.unstubAllGlobals());
describe("confirming server model persistence",()=>{
  it("never overwrites generation when an older backend ignores the judge query",async()=>{
    let generation={...saved,connection:{...saved.connection,model:"existing-generator"}};
    const fetch=vi.fn(async(url:string,init:RequestInit={})=>{
      if(url.startsWith("/api/evolution/ai-connection")){
        if(init.method==="PUT")generation={...generation,revision:generation.revision+1,connection:{...JSON.parse(String(init.body)),baseUrl:saved.connection.baseUrl}};
        return reply(generation);
      }
      return reply({statusMessage:"Not Found"},404);
    });vi.stubGlobal("fetch",fetch);
    await expect(saveServerAiConnection(input,"judge")).rejects.toThrow("尚不支持独立验收模型");
    expect(generation.connection.model).toBe("existing-generator");
    expect(fetch.mock.calls.some(call=>call[0].startsWith("/api/evolution/ai-connection")&&call[1]?.method==="PUT")).toBe(false);
  });
  it("reads the same role without a cache after PUT and returns only the confirmed public status",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(reply(saved)).mockResolvedValueOnce(reply(saved));vi.stubGlobal("fetch",fetch);
    const result=await saveServerAiConnection(input,"judge");
    expect(result.connection?.model).toBe(input.model);expect(JSON.stringify(result)).not.toContain(input.apiKey);
    expect(fetch.mock.calls.map(call=>call[0])).toEqual(["/api/evolution/ai-judge-connection","/api/evolution/ai-judge-connection"]);
    expect(fetch.mock.calls[1]![1]).toMatchObject({cache:"no-store"});
    expect(fetch.mock.calls[1]![1].method).toBeUndefined();
  });
  it.each([
    {...saved,revision:5},
    {...saved,connection:{...saved.connection,model:"old-model"}},
    {...saved,connection:{...saved.connection,responseFormat:"json-object"}},
    {...saved,configured:false,connection:undefined},
  ])("does not claim success when the readback differs",async readback=>{
    const fetch=vi.fn().mockResolvedValueOnce(reply(saved)).mockResolvedValueOnce(reply(readback));vi.stubGlobal("fetch",fetch);
    await expect(saveServerAiConnection(input)).rejects.toThrow("回读与本次配置不一致");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("reports a committed but unconfirmed save without replaying the write",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(reply(saved)).mockResolvedValueOnce(reply({statusMessage:"unavailable"},503));vi.stubGlobal("fetch",fetch);
    await expect(saveServerAiConnection(input)).rejects.toThrow("回读未确认");
    expect(fetch.mock.calls.filter(call=>call[1]?.method==="PUT")).toHaveLength(1);
  });
  it("does not read back or replay a rejected write",async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(reply({},403));vi.stubGlobal("fetch",fetch);
    await expect(saveServerAiConnection(input)).rejects.toThrow("请先连接后端工作区");expect(fetch).toHaveBeenCalledOnce();
  });
  it("requires a persisted revision rather than accepting two incomplete acknowledgements",async()=>{
    const fetch=vi.fn().mockImplementation(async()=>reply({...saved,revision:undefined}));vi.stubGlobal("fetch",fetch);
    await expect(saveServerAiConnection(input)).rejects.toThrow("回读与本次配置不一致");
  });
});
