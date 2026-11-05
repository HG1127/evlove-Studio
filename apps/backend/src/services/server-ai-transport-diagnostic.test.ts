// @vitest-environment node
import {afterEach,expect,it,vi} from "vitest";
import {AiProviderTransportDiagnosticSchema,type AiUsageLedgerRecord} from "@evolution/contracts";
import {fetchServerAiProviderUsage,measureServerAiSdkUsage,withServerAiUsageScope} from "./server-ai-usage";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {runServerAi} from "./ai-gateway";
import {currentServerAiTransportDiagnostic,recordServerAiTransportDiagnostic,withServerAiTransportDiagnosticScope} from "./server-ai-transport-diagnostic";
const config={mode:"openai-compatible" as const,apiKey:"SYNTHETIC_SECRET",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const,timeoutMs:600000};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const collect=async(work:()=>Promise<unknown>)=>{const rows:AiUsageLedgerRecord[]=[];const result=await withServerAiUsageScope({phase:"fixture"},work,async row=>{rows.push(row);}).catch(e=>e);return {rows,result};};
it("records the native request failure before the gateway discards its cause",async()=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_REQUEST_TIMEOUT_MS","");vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new TypeError("SYNTHETIC_SECRET URL body",{cause:{code:"UND_ERR_HEADERS_TIMEOUT"}})));
 const x=await collect(()=>withExplicitServerAiConnection({connectionId:"fixture",label:"fixture",...config},()=>runServerAi("evaluate",{fixture:true})));
 expect(x.rows).toHaveLength(2);const last=x.rows[1];expect(last).toMatchObject({kind:"request-result",observation:{schemaVersion:"ai-provider-usage-v3",outcome:"transport-error",transportDiagnostic:{phase:"request",origin:"native-headers",codes:["UND_ERR_HEADERS_TIMEOUT"]}}});
 expect(x.result).toMatchObject({code:"SERVER_AI_PROVIDER_TIMEOUT",transportDiagnostic:{origin:"native-headers"}});expect(JSON.stringify(x.result)).not.toContain("SYNTHETIC_SECRET");expect(JSON.stringify(x.rows)).not.toContain("URL body");expect(fetch).toHaveBeenCalledOnce();
});
it("records HTTP200 followed by a broken body as a body failure without retry",async()=>{
 const error=new TypeError("SENSITIVE body",{cause:{code:"UND_ERR_BODY_TIMEOUT"}}),response=new Response(new ReadableStream({start(controller){controller.error(error);}}),{status:200});
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response));
 const x=await collect(async()=>{const received=await fetchServerAiProviderUsage(config,"chat-completions","evaluate","https://fixture.invalid",{method:"POST"});return received.readJson();});
 expect(x.result).toBe(error);expect(x.rows[1]).toMatchObject({kind:"request-result",observation:{httpStatus:200,outcome:"transport-error",transportDiagnostic:{phase:"response-body",origin:"native-body"}}});expect(fetch).toHaveBeenCalledOnce();
});
it("propagates the actual response-body phase through the direct gateway",async()=>{
 const error=new TypeError("SENSITIVE body",{cause:{code:"UND_ERR_BODY_TIMEOUT"}}),response=new Response(new ReadableStream({start(controller){controller.error(error);}}),{status:200});
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response));
 const x=await collect(()=>withExplicitServerAiConnection({connectionId:"fixture",label:"fixture",...config},()=>runServerAi("evaluate",{})));
 expect(x.result).toMatchObject({code:"SERVER_AI_PROVIDER_TIMEOUT",transportDiagnostic:{phase:"response-body",origin:"native-body"}});
 const diagnostic=AiProviderTransportDiagnosticSchema.parse(Reflect.get(x.result as object,"transportDiagnostic"));
 expect(x.rows[1]).toMatchObject({kind:"request-result",observation:{transportDiagnostic:diagnostic}});
});
it("isolates concurrent invocation caches and ignores provider-supplied diagnostic properties",async()=>{
 const error={transportDiagnostic:{origin:"native-body"}},base={schemaVersion:"ai-provider-transport-diagnostic-v1" as const,phase:"request" as const,codes:[]};let release!:()=>void;
 const barrier=new Promise<void>(resolve=>{release=resolve;});
 const first=withServerAiTransportDiagnosticScope(async()=>{recordServerAiTransportDiagnostic(error,{...base,origin:"network"});await barrier;expect(currentServerAiTransportDiagnostic(error)?.origin).toBe("network");});
 const second=withServerAiTransportDiagnosticScope(async()=>{expect(currentServerAiTransportDiagnostic(error)).toBeUndefined();recordServerAiTransportDiagnostic(error,{...base,origin:"unknown"});release();expect(currentServerAiTransportDiagnostic(error)?.origin).toBe("unknown");});
 await Promise.all([first,second]);expect(currentServerAiTransportDiagnostic(error)).toBeUndefined();
});
it("records an exact request signal reason while leaving the failure and retry rule unchanged",async()=>{
 const controller=new AbortController();controller.abort(new DOMException("SENSITIVE","TimeoutError"));vi.stubGlobal("fetch",vi.fn().mockRejectedValue(controller.signal.reason));
 const x=await collect(()=>fetchServerAiProviderUsage(config,"chat-completions","evaluate","https://fixture.invalid",{method:"POST",signal:controller.signal}));
 expect(x.rows[1]).toMatchObject({kind:"request-result",observation:{transportDiagnostic:{origin:"request-signal",matchedSignal:"request",configuredTimeoutMs:600000}}});expect(x.result).toBe(controller.signal.reason);expect(fetch).toHaveBeenCalledOnce();
});
it("keeps SDK wrapper timeouts unassigned when its internal deadline identity is unavailable",async()=>{
 const error=Object.assign(new Error("SENSITIVE SDK"),{cause:{name:"TimeoutError"}});
 const x=await collect(()=>measureServerAiSdkUsage(config,"evaluate",async()=>{throw error;}));
 expect(x.rows[1]).toMatchObject({kind:"request-result",observation:{schemaVersion:"ai-provider-usage-v3",outcome:"sdk-error",transportDiagnostic:{phase:"sdk-generation",origin:"transport-timeout"}}});expect(x.result).toBe(error);expect(JSON.stringify(x.rows)).not.toContain("SENSITIVE SDK");
});
