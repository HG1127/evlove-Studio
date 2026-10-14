// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const settings={connectionId:"synthetic",label:"Synthetic",baseUrl:"https://model.example.test/v1",apiKey:"fictional-key",model:"fixture-model",protocol:"chat-completions" as const,responseFormat:"json-object" as const};
const report={accuracy:80,evidence:80,riskCoverage:80,completeness:80,safety:"PASS",notes:[],failures:[],cases:[{testCaseId:"V1",accuracy:80,evidence:80,completeness:80,reason:"observed"}],criteria:[{criterionId:"C1",score:80,pass:false,evidence:[],gaps:[],testCaseIds:["V1"]}]};
const reply=(content:string)=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content}}]}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe("private correction failure retains only local diagnostics",()=>{
  it.each([400,404,500])("retains HTTP %s and fixed code without provider echo",async status=>{
    const fetch=vi.fn(async()=>fetch.mock.calls.length===1?reply('{invalid private final marker}'):
      new Response(JSON.stringify({error:{message:'private final marker fictional\\u002dkey'}}),{status}));
    vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error.code).toBe("AI_OUTPUT_CORRECTION_FAILED");
    expect(error.message).toContain("AI_OUTPUT_CORRECTION_FAILED");expect(error.message).toContain(`HTTP=${status}`);
    expect(error.message).not.toContain("private final marker");expect(error.message).not.toContain("fictional");expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retains a missing score path and issue kind without its private values",async()=>{
    const broken={...report,criteria:[{...report.criteria[0],score:"private-score-value"}]};
    const fetch=vi.fn(async()=>reply(fetch.mock.calls.length===1?'{invalid private first}':JSON.stringify(broken)));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error.code).toBe("AI_OUTPUT_SCHEMA_MISMATCH");expect(error.message).toContain("AI_OUTPUT_SCHEMA_MISMATCH");
    expect(error.message).toContain("criteria.[].score");expect(error.message).toContain("invalid_type");expect(error.message).not.toContain("private-score-value");expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retains semantic duplicate category without exposing the actual identifier",async()=>{
    const row={...report.cases[0],testCaseId:"private-duplicate-id"};
    const fetch=vi.fn(async()=>reply(fetch.mock.calls.length===1?'{invalid private first}':JSON.stringify({...report,cases:[row,row]})));vi.stubGlobal("fetch",fetch);
    const error=await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{})).catch(error=>error);
    expect(error.code).toBe("AI_OUTPUT_SCHEMA_MISMATCH");expect(error.message).toContain("cases.[].testCaseId");expect(error.message).toContain("custom");expect(error.message).not.toContain("private-duplicate-id");expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not change either native correction request or the original evidence",async()=>{
    const calls:Array<{messages:unknown[]}> = [];
    const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{calls.push(JSON.parse(String(init?.body)));return reply(fetch.mock.calls.length===1?'{invalid private first}':JSON.stringify(report));});vi.stubGlobal("fetch",fetch);
    expect(await withExplicitServerAiConnection(settings,()=>runServerAi("evaluate",{unchangedEvidence:"synthetic"}))).toEqual(report);
    expect(calls).toHaveLength(2);expect(calls[1]!.messages).toHaveLength(3);expect(calls[1]!.messages[1]).toEqual(calls[0]!.messages[1]);
  });
});
