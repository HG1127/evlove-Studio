// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {summarizeAiUsageLedger} from "@evolution/core";
import type {AiUsageLedgerRecord} from "@evolution/contracts";
import type {ServerAiConfig} from "../server-env";
import {fetchServerAiProviderUsage,measureServerAiSdkUsage,withServerAiUsageScope} from "./server-ai-usage";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

const config:ServerAiConfig={mode:"openai-compatible",baseUrl:"https://provider.test/private?key=PRIVATE_URL",apiKey:"PRIVATE_API_KEY",model:"model",timeoutMs:1000,protocol:"chat-completions",responseFormat:"json-object"};
const scope={missionId:"mission",jobId:"job",phase:"experiment"};
const reply=()=>({id:"req_1",model:"model",usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14},choices:[{message:{content:"PRIVATE_REPLY"}}]});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("request-bound server usage collection",()=>{
  it("retains both provider responses when malformed task JSON requires one structured retry",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({...reply(),choices:[{finish_reason:"stop",message:{content:"{invalid JSON"}}]})))
      .mockResolvedValueOnce(new Response(JSON.stringify({...reply(),choices:[{finish_reason:"stop",message:{content:JSON.stringify({output:"UNVERIFIED: diagnostic without source input"})}}]})));
    vi.stubGlobal("fetch",fetchMock);
    await withServerAiUsageScope(scope,()=>withExplicitServerAiConnection({connectionId:"test",label:"Test",apiKey:"PRIVATE_API_KEY",
      baseUrl:"https://provider.test/v1",model:"model",protocol:"chat-completions",responseFormat:"json-object"},()=>runServerAi("execute-artifact",{diagnostic:"PRIVATE_PROMPT"})),async record=>{records.push(record);});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for(const record of records.filter(record=>record.kind==="request-result"))expect(record.observation).toMatchObject({schemaVersion:"ai-provider-usage-v2",completion:{finishReason:"stop"}});
    expect(summarizeAiUsageLedger(records)).toMatchObject({startedRequests:2,matchedObservations:2,ledgerComplete:true,tokenCoverageComplete:true,reportedTokens:{input:20,output:8,total:28},billingStatus:"unavailable"});
    expect(JSON.stringify(records)).not.toMatch(/PRIVATE|invalid JSON|diagnostic without source/);
  });
  it("records physical reset retries independently, preserves unknown first-request charges and omits content/credentials",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    const fetchMock=vi.fn().mockRejectedValueOnce(new TypeError("fetch failed",{cause:{code:"ECONNRESET"}})).mockResolvedValueOnce(new Response(JSON.stringify(reply())));
    vi.stubGlobal("fetch",fetchMock);
    await withServerAiUsageScope(scope,async()=>{
      const measured=await fetchServerAiProviderUsage(config,"chat-completions","execute-artifact",config.baseUrl,{body:"PRIVATE_PROMPT"});
      const json=await measured.response.json();await measured.observe(json);await measured.observe(json);
    },async record=>{records.push(record);});
    expect(records.map(record=>record.kind)).toEqual(["request-start","request-result","request-start","request-result"]);
    expect(summarizeAiUsageLedger(records)).toMatchObject({startedRequests:2,physicalHttpAttempts:2,transportFailures:1,ledgerComplete:true,tokenCoverageComplete:false,
      reportedTokens:{input:10,output:4,total:14},billingStatus:"unavailable"});
    expect(JSON.stringify(records)).not.toMatch(/PRIVATE|provider\.test|Authorization|choices/);
  });
  it("does not send a request if its durable start cannot be written",async()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    await expect(withServerAiUsageScope(scope,()=>fetchServerAiProviderUsage(config,"responses","execute-artifact",config.baseUrl,{}),async()=>{throw Error("write failed");}))
      .rejects.toMatchObject({code:"AI_USAGE_START_NOT_RECORDED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not repeat a completed response on result-write failure; its unmatched durable start remains an explicit gap",async()=>{
    const records:AiUsageLedgerRecord[]=[],fetchMock=vi.fn(async()=>new Response(JSON.stringify(reply())));vi.stubGlobal("fetch",fetchMock);
    const warning=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
    await withServerAiUsageScope(scope,async()=>{
      const measured=await fetchServerAiProviderUsage(config,"chat-completions","execute-artifact",config.baseUrl,{});
      await measured.observe(await measured.response.json());
    },async record=>{if(record.kind==="request-result")throw Error("PRIVATE_WRITE_ERROR");records.push(record);});
    expect(fetchMock).toHaveBeenCalledTimes(1);expect(warning.mock.calls[0]?.[0]).toBe("AI_USAGE_RESULT_NOT_RECORDED");
    expect(summarizeAiUsageLedger(records)).toMatchObject({ledgerComplete:false,tokenCoverageComplete:false,matchedObservations:0});
    expect(JSON.stringify(warning.mock.calls)).not.toContain("PRIVATE");
  });
  it("keeps concurrent Mission/Job attribution separate",async()=>{
    const records:AiUsageLedgerRecord[]=[];vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(reply()))));
    await Promise.all(["one","two"].map(id=>withServerAiUsageScope({missionId:id,jobId:id,phase:"judge"},async()=>{
      await Promise.resolve();const measured=await fetchServerAiProviderUsage(config,"chat-completions","evaluate",config.baseUrl,{});
      await measured.observe(await measured.response.json());
    },async record=>{records.push(record);})));
    for(const id of ["one","two"]){
      const own=records.filter(record=>(record.kind==="request-start"?record.request:record.observation.request).scope.missionId===id);
      expect(own).toHaveLength(2);expect(summarizeAiUsageLedger(own).tokenCoverageComplete).toBe(true);
    }
  });
  it("preserves an opaque user-selected model ID without introducing a narrower routing constraint",async()=>{
    const records:AiUsageLedgerRecord[]=[];vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(reply()))));
    await withServerAiUsageScope(scope,async()=>{
      const measured=await fetchServerAiProviderUsage({...config,model:"自定义模型 v1"},"chat-completions","execute-artifact",config.baseUrl,{});
      await measured.observe(await measured.response.json());
    },async record=>{records.push(record);});
    expect(records[0]?.kind==="request-start"&&records[0].request.route.model).toBe("自定义模型 v1");
  });
  it("records SDK usage without pretending its internal retries were visible",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    const generated={totalUsage:{inputTokens:12,outputTokens:3,totalTokens:15},response:{id:"sdk_1",modelId:"model"},finishReason:"stop",output:{private:"PRIVATE_SDK_OUTPUT"}};
    expect(await withServerAiUsageScope(scope,()=>measureServerAiSdkUsage(config,"copilot",async()=>generated),async record=>{records.push(record);})).toBe(generated);
    expect(summarizeAiUsageLedger(records)).toMatchObject({sdkGenerations:1,physicalHttpAttempts:0,ledgerComplete:true,tokenCoverageComplete:false,reportedTokens:{total:15}});
    expect(records[1]?.kind==="request-result"&&records[1].observation).toMatchObject({schemaVersion:"ai-provider-usage-v2",completion:{finishReason:"stop"}});
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
  });
  it("records SDK failure usage while returning the original error",async()=>{
    const records:AiUsageLedgerRecord[]=[],error=Object.assign(new Error("PRIVATE_ERROR"),{usage:{inputTokens:2,outputTokens:1,totalTokens:3},finishReason:"length"});
    await expect(withServerAiUsageScope(scope,()=>measureServerAiSdkUsage(config,"evaluate",async()=>{throw error;}),async record=>{records.push(record);})).rejects.toBe(error);
    expect(records[1]?.kind==="request-result"&&records[1].observation.outcome).toBe("sdk-error");
    expect(records[1]?.kind==="request-result"&&records[1].observation).toMatchObject({schemaVersion:"ai-provider-usage-v2",completion:{finishReason:"length"}});
    expect(JSON.stringify(records)).not.toContain("PRIVATE");
  });
});
