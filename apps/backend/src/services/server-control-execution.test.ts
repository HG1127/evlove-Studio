// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolutionJob,type AiUsageLedgerRecord} from "@evolution/contracts";
import {summarizeAiUsageLedger} from "@evolution/core";
import {abortServerControlExecutions,assertServerControlExecutionActive,serverControlExecutionSignal,withServerControlExecution} from "./server-control-execution";
import {withServerAiUsageScope} from "./server-ai-usage";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {runServerAi} from "./ai-gateway";

const at="2026-10-27T00:00:00.000Z";
const input={missionId:"mission",controlJobId:"control",requestedAt:at};
const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:"mission",type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:control",generation:1,attempts:1,priority:70,createdAt:at,updatedAt:at});
const connection={connectionId:"test",label:"Test",apiKey:"private",baseUrl:"https://provider.test/v1",model:"model",protocol:"chat-completions" as const,responseFormat:"json-object" as const};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe("control execution cancellation",()=>{
  it("does not issue a structured-output retry after durable cancellation, while preserving the first usage receipt",async()=>{
    let current:EvolutionJob={...job};const records:AiUsageLedgerRecord[]=[];
    const fetchMock=vi.fn(async()=>{
      current={...job,status:"cancelled"};
      return new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12},choices:[{message:{content:"{malformed"}}]}));
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(withServerControlExecution(input,async()=>current,()=>withServerAiUsageScope({missionId:"mission",jobId:"control",phase:"fixture"},()=>
      withExplicitServerAiConnection(connection,()=>runServerAi("execute-artifact",{input:"fixture"})),async record=>{records.push(record);})))
      .rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summarizeAiUsageLedger(records)).toMatchObject({startedRequests:1,matchedObservations:1,reportedTokens:{total:12}});
  });
  it("aborts a pending physical request when another instance cancels the durable Job",async()=>{
    vi.useFakeTimers();let current:EvolutionJob={...job};let started!:()=>void;
    const ready=new Promise<void>(resolve=>{started=resolve;});
    const fetchMock=vi.fn((_url:unknown,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      const signal=init.signal!;
      signal.addEventListener("abort",()=>reject(signal.reason),{once:true});started();
    }));
    vi.stubGlobal("fetch",fetchMock);
    const running=withServerControlExecution(input,async()=>current,()=>withExplicitServerAiConnection(connection,()=>runServerAi("execute-artifact",{})),20);
    const rejected=expect(running).rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
    await ready;current={...job,status:"cancelled"};await vi.advanceTimersByTimeAsync(20);await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("local abort is bound to Job identity and generation",async()=>{
    await withServerControlExecution(input,async()=>job,async()=>{
      const signal=serverControlExecutionSignal()!;
      abortServerControlExecutions({...job,generation:2});expect(signal.aborted).toBe(false);
      abortServerControlExecutions({...job,missionId:"other"});expect(signal.aborted).toBe(false);
      abortServerControlExecutions(job);expect(signal.aborted).toBe(true);
      await expect(assertServerControlExecutionActive()).rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
    });
  });
  it("fails closed if the durable Job read fails and leaves unrelated AI calls unscoped",async()=>{
    const work=vi.fn();
    await expect(withServerControlExecution(input,async()=>{throw Error("database unavailable");},work)).rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
    expect(work).not.toHaveBeenCalled();
    expect(serverControlExecutionSignal()).toBeUndefined();
    await expect(assertServerControlExecutionActive()).resolves.toBeUndefined();
  });
});
