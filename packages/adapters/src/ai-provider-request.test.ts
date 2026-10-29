// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {aiProviderTransportFailure,fetchAiProvider} from "./ai-provider-request";

const networkError=()=>new TypeError("fetch failed",{cause:{code:"ECONNRESET"}});
afterEach(()=>vi.unstubAllGlobals());
describe("bounded provider connection recovery",()=>{
  it("retries a reset once with the same request and deadline",async()=>{
    const reply=new Response("ok");
    const fetchMock=vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(reply);
    vi.stubGlobal("fetch",fetchMock);
    const init={method:"POST",body:'{"model":"real-model"}',signal:AbortSignal.timeout(5000)};
    expect(await fetchAiProvider("https://provider.test/v1/chat/completions",init)).toBe(reply);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(fetchMock.mock.calls[0]);
    expect(fetchMock.mock.calls[1][1]).toBe(init);
  });
  it("stops after the second connection failure",async()=>{
    const error=networkError();
    const fetchMock=vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch",fetchMock);
    await expect(fetchAiProvider("https://provider.test",{})).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","ETIMEDOUT"])("detects nested %s before the outer fetch error and does not retry",async(code)=>{
    const error=new TypeError("fetch failed",{cause:{code}});
    expect(aiProviderTransportFailure(error)).toBe("provider-timeout");
    const fetchMock=vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch",fetchMock);
    await expect(fetchAiProvider("https://provider.test",{})).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not start another request after the original signal expires",async()=>{
    const fetchMock=vi.fn().mockRejectedValue(networkError());
    vi.stubGlobal("fetch",fetchMock);
    await expect(fetchAiProvider("https://provider.test",{signal:AbortSignal.abort()})).rejects.toThrow("fetch failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([401,402,429,500,503])("leaves HTTP %s classification to the caller without retrying",async(status)=>{
    const response=new Response("error",{status});
    const fetchMock=vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch",fetchMock);
    expect(await fetchAiProvider("https://provider.test",{})).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reconnects once for an explicit selected-model capacity rejection with the same body and deadline",async()=>{
    const busy={error:{message:"Selected model is at capacity. Please try a different model."}},first=new Response(JSON.stringify(busy),{status:503}),reply=new Response("ok");
    const fetchMock=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(reply);vi.stubGlobal("fetch",fetchMock);
    const init={method:"POST",body:'{"model":"same-model","input":"same-task"}',signal:AbortSignal.timeout(5000)};
    expect(await fetchAiProvider("https://provider.test",init)).toBe(reply);expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1]?.[1]).toBe(init);
  });
  it("does not reconnect on payment limits even if the body also mentions capacity",async()=>{
    const denied=new Response(JSON.stringify({error:{message:"Selected model is at capacity. Upgrade to continue."}}),{status:402}),fetchMock=vi.fn().mockResolvedValue(denied);vi.stubGlobal("fetch",fetchMock);
    expect(await fetchAiProvider("https://provider.test",{})).toBe(denied);expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("shares one reconnection allowance between network resets and capacity rejections",async()=>{
    const busy=new Response(JSON.stringify({error:{message:"Selected model is at capacity. Please try a different model."}}),{status:503}),fetchMock=vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(busy);vi.stubGlobal("fetch",fetchMock);
    expect(await fetchAiProvider("https://provider.test",{})).toBe(busy);expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([429,503,529])("keeps capacity recovery bounded for HTTP %s and preserves the rejected body",async status=>{
    const message="Selected model is at capacity. Please try a different model.",first=new Response(message,{status}),last=new Response(message,{status}),fetchMock=vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(last);vi.stubGlobal("fetch",fetchMock);
    expect(await fetchAiProvider("https://provider.test",{})).toBe(last);expect(fetchMock).toHaveBeenCalledTimes(2);expect(await first.text()).toBe(message);expect(await last.text()).toBe(message);
  });
  it("stops a pending reconnection when the original signal is cancelled",async()=>{
    const controller=new AbortController(),fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{message:"Selected model is at capacity."}}),{status:503}));vi.stubGlobal("fetch",fetchMock);
    await expect(fetchAiProvider("https://provider.test",{signal:controller.signal},{beforeAttempt:async()=>{},failedAttempt:async()=>{},retryableResponse:async()=>{setTimeout(()=>controller.abort(new DOMException("original cancelled","AbortError")),10);}})).rejects.toMatchObject({name:"AbortError"});
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not discard a response containing a completed model output alongside an error",async()=>{
    const response=new Response(JSON.stringify({error:{message:"Selected model is at capacity."},choices:[{message:{content:"completed output"}}]}),{status:503}),fetchMock=vi.fn().mockResolvedValue(response);vi.stubGlobal("fetch",fetchMock);
    expect(await fetchAiProvider("https://provider.test",{})).toBe(response);expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("keeps programming and schema errors distinct from network availability",async()=>{
    const error=new TypeError("Unexpected schema value");
    expect(aiProviderTransportFailure(error)).toBeUndefined();
    const fetchMock=vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch",fetchMock);
    await expect(fetchAiProvider("https://provider.test",{})).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
