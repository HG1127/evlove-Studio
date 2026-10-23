import {describe,expect,it} from "vitest";
import {observeAiProviderUsage} from "./ai-provider-usage";

describe("actual provider usage normalization",()=>{
  it("retains observed chat counters without adding reasoning/cache twice or retaining private provider data",()=>{
    const result=observeAiProviderUsage({id:"req_123",model:"MiniMax-M2.7-highspeed",choices:[{message:{content:"PRIVATE_REPLY"}}],
      usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18,prompt_tokens_details:{cached_tokens:4},completion_tokens_details:{reasoning_tokens:6},cost:0,private:"PRIVATE_USAGE"}},"chat-completions");
    expect(result).toEqual({responseId:"req_123",responseModel:"MiniMax-M2.7-highspeed",usage:{status:"complete",counts:{input:10,output:8,total:18,reasoning:6,cacheRead:4}}});
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|cost/);
  });
  it("uses Responses field names and never invents a missing total",()=>{
    expect(observeAiProviderUsage({usage:{input_tokens:11,output_tokens:3,input_tokens_details:{cached_tokens:2}}},"responses").usage)
      .toEqual({status:"partial",counts:{input:11,output:3,cacheRead:2}});
  });
  it("uses installed SDK v7 token detail names",()=>{
    expect(observeAiProviderUsage({usage:{inputTokens:12,outputTokens:9,totalTokens:21,inputTokenDetails:{cacheReadTokens:8},outputTokenDetails:{reasoningTokens:7}}},"ai-sdk").usage)
      .toEqual({status:"complete",counts:{input:12,output:9,total:21,reasoning:7,cacheRead:8}});
  });
  it.each([undefined,null,{}, {prompt_tokens_details:{}}])("keeps absent usage %j unknown",usage=>{
    expect(observeAiProviderUsage({usage},"chat-completions").usage).toMatchObject({status:"unavailable",counts:{}});
  });
  it.each([-1,1.2,"3",NaN,Infinity,Number.MAX_SAFE_INTEGER+1])("rejects invalid actual counters %s",value=>{
    expect(observeAiProviderUsage({usage:{prompt_tokens:value}},"chat-completions").usage.status).toBe("invalid");
  });
  it.each([{prompt_tokens:2,completion_tokens:3,total_tokens:1},{completion_tokens:1,completion_tokens_details:{reasoning_tokens:2}},{prompt_tokens:1,prompt_tokens_details:{cached_tokens:2}}])("does not accept inconsistent counters",usage=>{
    expect(observeAiProviderUsage({usage},"chat-completions").usage).toMatchObject({status:"invalid",reason:"inconsistent-counts"});
  });
  it("preserves genuinely reported zero tokens while never emitting an inferred zero bill",()=>{
    expect(observeAiProviderUsage({usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}},"chat-completions").usage).toMatchObject({status:"complete",counts:{input:0,output:0,total:0}});
    expect(observeAiProviderUsage({id:"private response text",model:"sensitive query?key=SECRET",usage:{}},"chat-completions")).toMatchObject({responseId:undefined,responseModel:undefined});
  });
});
