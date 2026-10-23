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
  it.each([401,429,500])("leaves HTTP %s classification to the caller without retrying",async(status)=>{
    const response=new Response("error",{status});
    const fetchMock=vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch",fetchMock);
    expect(await fetchAiProvider("https://provider.test",{})).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
