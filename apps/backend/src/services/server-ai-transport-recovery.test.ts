// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {runServerAi,serverAiUnavailableReason} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {probeServerAiRuntime,resetServerAiRuntimeProbeCache} from "./server-ai-health";
import {runServerControlAi,ServerControlAiUnavailableError} from "./server-control-ai";

const settings={
  connectionId:"synthetic-transport",label:"Synthetic transport",apiKey:"fictional-transport-key",
  baseUrl:"https://synthetic.example.test/v1",model:"synthetic-model",
  protocol:"chat-completions" as const,responseFormat:"json-object" as const,
};
const understanding={
  intentRestatement:"Synthetic readiness",implicitRequirements:[],assumptions:[],
  clarifications:[],acceptanceFocus:[],confidence:0.8,
};
const networkFailure=()=>new TypeError("fetch failed "+settings.apiKey,{
  cause:Object.assign(new Error("synthetic socket failure"),{code:"ECONNRESET"}),
});
const timeoutFailure=()=>new DOMException("synthetic request timeout "+settings.apiKey,"TimeoutError");
afterEach(()=>{vi.unstubAllGlobals();resetServerAiRuntimeProbeCache();});

describe("direct provider transport recovery (synthetic faults only)",()=>{
  it.each(["chat-completions","responses"] as const)("%s retains typed request/body failures without endpoint fallback",async protocol=>{
    for(const [phase,makeFailure,reasonCode] of [
      ["request",timeoutFailure,"provider-timeout"],
      ["body",timeoutFailure,"provider-timeout"],
      ["request",networkFailure,"provider-network-error"],
      ["body",networkFailure,"provider-network-error"],
    ] as const){
      const failure=makeFailure();
      const fetchMock=vi.fn(async()=>{
        if(phase==="request")throw failure;
        const response=new Response("");
        vi.spyOn(response,"json").mockRejectedValue(failure);
        return response;
      });
      vi.stubGlobal("fetch",fetchMock);
      const error=await withExplicitServerAiConnection({...settings,protocol},()=>runServerAi("copilot",{}))
        .catch((caught:unknown)=>caught);
      expect(error).toBeInstanceOf(Error);
      expect(serverAiUnavailableReason(error),phase+" "+reasonCode).toBe(reasonCode);
      expect((error as Error).message).not.toContain(settings.apiKey);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it.each([["timeout",timeoutFailure,"provider-timeout"],["network",networkFailure,"provider-network-error"]] as const)("reports %s as unavailable during an actual health-probe request",async(_label,makeFailure,reasonCode)=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw makeFailure();}));
    const health=await withExplicitServerAiConnection(settings,()=>probeServerAiRuntime(undefined,{force:true,isolated:true}));
    expect(health).toMatchObject({ready:false,runtimeVerified:true,status:"unavailable",reasonCode});
    expect(JSON.stringify(health)).not.toContain(settings.apiKey);
  });

  it.each([["timeout",timeoutFailure,"provider-timeout"],["network",networkFailure,"provider-network-error"]] as const)("keeps %s after a successful probe in the existing control capability-wait path",async(_label,makeFailure,reasonCode)=>{
    const fetchMock=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(understanding)}}]})))
      .mockRejectedValueOnce(makeFailure());
    vi.stubGlobal("fetch",fetchMock);
    const error=await withExplicitServerAiConnection(settings,()=>runServerControlAi("copilot",{}))
      .catch((caught:unknown)=>caught);
    expect(error).toBeInstanceOf(ServerControlAiUnavailableError);
    expect(error).toMatchObject({reasonCode});
    expect((error as Error).message).not.toContain(settings.apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([new Error("schema timeout"),new TypeError("programming failure"),new SyntaxError("malformed JSON")])("does not classify an unknown request/contract failure as provider availability",async failure=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw failure;}));
    const error=await withExplicitServerAiConnection(settings,()=>runServerAi("copilot",{}))
      .catch((caught:unknown)=>caught);
    expect(serverAiUnavailableReason(error)).toBeUndefined();
  });
});
