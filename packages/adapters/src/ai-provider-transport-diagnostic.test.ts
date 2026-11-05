// @vitest-environment node
import {describe,expect,it} from "vitest";
import {AiProviderTransportDiagnosticSchema,AiProviderUsageObservationSchema} from "@evolution/contracts";
import {aiProviderTransportDiagnostic} from "./ai-provider-transport-diagnostic";

const context={phase:"request" as const,configuredTimeoutMs:600000};
describe("safe transport attribution",()=>{
  it.each([["UND_ERR_CONNECT_TIMEOUT","native-connect"],["UND_ERR_HEADERS_TIMEOUT","native-headers"],["UND_ERR_BODY_TIMEOUT","native-body"]])("retains nested %s without error text",(code,origin)=>{
    const error=new TypeError("SENSITIVE request URL and key",{cause:Object.assign(new Error("SENSITIVE response body"),{code})});
    const diagnostic=aiProviderTransportDiagnostic(error,context);
    expect(diagnostic).toMatchObject({origin,codes:[code],configuredTimeoutMs:600000});expect(JSON.stringify(diagnostic)).not.toContain("SENSITIVE");
  });
  it("identifies the actual input signal reason, not a similarly named error",()=>{
    const controller=new AbortController();controller.abort(new DOMException("SENSITIVE deadline","TimeoutError"));
    expect(aiProviderTransportDiagnostic(new TypeError("fetch failed",{cause:controller.signal.reason}),{...context,requestSignal:controller.signal})).toMatchObject({origin:"request-signal",matchedSignal:"request"});
    expect(aiProviderTransportDiagnostic(new DOMException("same name, unrelated reason","TimeoutError"),{...context,requestSignal:controller.signal})).toMatchObject({origin:"transport-timeout"});
  });
  it("does not blame an already expired signal for an independent body timeout",()=>{
    const controller=new AbortController();controller.abort(new DOMException("deadline","TimeoutError"));
    const diagnostic=aiProviderTransportDiagnostic({cause:{code:"UND_ERR_BODY_TIMEOUT"}},{...context,requestSignal:controller.signal});
    expect(diagnostic).toMatchObject({origin:"native-body",codes:["UND_ERR_BODY_TIMEOUT"]});expect(diagnostic.matchedSignal).toBeUndefined();
  });
  it("retains competing evidence as unknown instead of choosing a timeout layer",()=>{
    const controller=new AbortController(),reason=Object.assign(new Error("SENSITIVE"),{code:"UND_ERR_BODY_TIMEOUT"});controller.abort(reason);
    expect(aiProviderTransportDiagnostic(reason,{...context,requestSignal:controller.signal})).toMatchObject({origin:"unknown",matchedSignal:"request",codes:["UND_ERR_BODY_TIMEOUT"]});
  });
  it("distinguishes an exact execution cancellation from the request timer",()=>{
    const own=new AbortController(),execution=new AbortController(),reason=Object.assign(new Error("SENSITIVE control"),{code:"SERVER_CONTROL_EXECUTION_STOPPED"});
    execution.abort(reason);const combined=AbortSignal.any([own.signal,execution.signal]);
    expect(aiProviderTransportDiagnostic(reason,{...context,requestSignal:own.signal,executionSignal:combined})).toMatchObject({origin:"execution-signal",matchedSignal:"execution"});
  });
  it("does not choose either signal when distinct exact reasons occur in the same chain",()=>{
    const request=new AbortController(),execution=new AbortController(),executionReason=new Error("execution"),requestReason=new Error("request",{cause:executionReason});
    request.abort(requestReason);execution.abort(executionReason);
    expect(aiProviderTransportDiagnostic(requestReason,{...context,requestSignal:request.signal,executionSignal:execution.signal})).toMatchObject({origin:"unknown",matchedSignal:"both"});
  });
  it("does not call two signals carrying the same request reason a control cancellation",()=>{
    const own=new AbortController();own.abort(new DOMException("deadline","TimeoutError"));const combined=AbortSignal.any([own.signal]);
    expect(aiProviderTransportDiagnostic(own.signal.reason,{...context,requestSignal:own.signal,executionSignal:combined})).toMatchObject({origin:"request-signal",matchedSignal:"request"});
  });
  it("retains SDK timeout uncertainty without inventing ownership",()=>{
    expect(aiProviderTransportDiagnostic({cause:{name:"TimeoutError"}},{phase:"sdk-generation"})).toMatchObject({origin:"transport-timeout",phase:"sdk-generation"});
    expect(aiProviderTransportDiagnostic({cause:{code:"UND_ERR_HEADERS_TIMEOUT"}},{phase:"sdk-generation"})).toMatchObject({origin:"native-headers"});
  });
  it("bounds cyclic and throwing error objects without copying arbitrary codes",()=>{
    const cycle:Record<string,unknown>={code:"ECONNRESET"};cycle.cause=cycle;
    expect(aiProviderTransportDiagnostic(cycle,context)).toMatchObject({origin:"network",codes:["ECONNRESET"]});
    const error=Object.defineProperties({},{code:{get(){throw Error("SENSITIVE");}},cause:{get(){throw Error("SENSITIVE");}}});
    expect(aiProviderTransportDiagnostic(error,{...context,configuredTimeoutMs:Infinity})).toMatchObject({origin:"unknown",codes:[]});
    expect(aiProviderTransportDiagnostic({code:"SENSITIVE-token"},context).codes).toEqual([]);
  });
  it("rejects unbounded diagnostic additions at the storage boundary",()=>{
    const value=aiProviderTransportDiagnostic({code:"UND_ERR_HEADERS_TIMEOUT"},context);
    expect(AiProviderTransportDiagnosticSchema.safeParse({...value,message:"SENSITIVE"}).success).toBe(false);
    expect(AiProviderTransportDiagnosticSchema.safeParse({...value,codes:["SENSITIVE"]}).success).toBe(false);
    expect(AiProviderTransportDiagnosticSchema.safeParse({...value,origin:"native-body"}).success).toBe(false);
    expect(AiProviderTransportDiagnosticSchema.safeParse({...value,origin:"request-signal"}).success).toBe(false);
    expect(AiProviderTransportDiagnosticSchema.safeParse({...value,codes:["UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT"],matchedSignal:"request"}).success).toBe(false);
  });
  it("preserves old records and versions new failure diagnostics",()=>{
    const observation={schemaVersion:"ai-provider-usage-v2",request:{schemaVersion:"ai-usage-request-v1",callId:"00000000-0000-4000-8000-000000000000",scope:{phase:"fixture"},route:{operation:"evaluate",protocol:"chat-completions",model:"fixture",routeFingerprint:"a".repeat(64)},granularity:"physical-http-attempt",attempt:1,startedAt:"2026-11-05T00:00:00Z"},completedAt:"2026-11-05T00:00:01Z",elapsedMs:1000,outcome:"transport-error",transportReason:"provider-timeout",usage:{status:"unavailable",counts:{},reason:"missing-usage"},billing:{status:"unavailable"},completion:null};
    expect(AiProviderUsageObservationSchema.parse(observation)).toEqual(observation);
    const next={...observation,schemaVersion:"ai-provider-usage-v3",transportDiagnostic:aiProviderTransportDiagnostic({code:"UND_ERR_HEADERS_TIMEOUT"},context)};
    expect(AiProviderUsageObservationSchema.parse(next)).toEqual(next);
    expect(AiProviderUsageObservationSchema.safeParse({...next,outcome:"response"}).success).toBe(false);
    expect(AiProviderUsageObservationSchema.safeParse({...observation,transportDiagnostic:next.transportDiagnostic}).success).toBe(false);
  });
});
