// @vitest-environment node
import {createHash} from "node:crypto";
import {SERVER_SEMANTIC_CONTEXT_VERSION} from "@evolution/harness";
import {COMPATIBLE_CHAT_OUTPUT_VERSION} from "@evolution/adapters";
import {afterEach,describe,expect,it,vi} from "vitest";
import {jsonSchemas,ServerAiConnectionPutSchema} from "@evolution/contracts";
import {DIRECT_AI_SCHEMA_RECOVERY_VERSION,DIRECT_AI_SCHEMA_INSTRUCTION_VERSION,runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import * as vault from "./server-vault";

const report={accuracy:100,evidence:100,riskCoverage:100,completeness:100,safety:"PASS",notes:[],failures:[],cases:[{testCaseId:"V1",accuracy:100,evidence:100,completeness:100,reason:"observed"}],criteria:[{criterionId:"C1",score:100,pass:true,evidence:["measured"],gaps:[],testCaseIds:["V1"]}]};
const payload={mode:"server-baseline",testCases:[{id:"V1",criterionIds:["C1"]}],runs:[{testCaseId:"V1",outputChunks:["measured fixture"],verificationStatus:"verified"}]};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("direct model exact schema instructions",()=>{
  for(const protocol of ["chat-completions","responses"] as const){
    it.each([undefined,"json-schema","json-object","prompt-json"] as const)(protocol+" includes the exact schema for %s output",async(responseFormat)=>{
      const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
        const request=JSON.parse(String(init?.body));
        const system=protocol==="chat-completions"?request.messages[0].content:request.input[0].content[0].text;
        const marker="Return JSON matching this exact schema:";
        const schemaText=system.includes(marker)?system.slice(system.indexOf(marker)+marker.length).trim():undefined;
        const schemaKnown=schemaText&&JSON.stringify(JSON.parse(schemaText))===JSON.stringify(jsonSchemas.evaluate.schema);
        expect(protocol==="chat-completions"?request.messages[1].content:request.input[1].content[0].text).toBe(JSON.stringify(payload));
        // A compatible provider may accept but ignore wire-level response_format.
        const output=JSON.stringify(schemaKnown?report:{summary:"valid JSON without the task's required fields"});
        return new Response(JSON.stringify(protocol==="chat-completions"?{choices:[{message:{role:"assistant",content:output},finish_reason:"stop"}]}:{status:"completed",output_text:output}),{status:200,headers:{"Content-Type":"application/json"}});
      });
      vi.stubGlobal("fetch",fetch);
      const result=await withExplicitServerAiConnection(ServerAiConnectionPutSchema.parse({connectionId:"fixture-connection",label:"Synthetic direct model",baseUrl:"https://model.example.test/v1",apiKey:"fixture-key",model:"fixture-model",protocol,responseFormat}),()=>runServerAi("evaluate",payload));
      expect(result).toEqual(report);expect(fetch).toHaveBeenCalledOnce();
    });
  }
});

describe("environment direct model schema instructions",()=>{
  it.each(["responses","chat-fallback"])("includes the exact evaluation schema on %s",async(protocol)=>{
    vi.stubEnv("EVOLUTION_AI_GATEWAY_ENABLED","false");vi.stubEnv("EVOLUTION_AI_API_KEY","fixture-key");vi.stubEnv("EVOLUTION_AI_MODEL","fixture-model");vi.stubEnv("EVOLUTION_AI_BASE_URL","https://model.example.test/v1");
    vi.spyOn(vault,"resolveVaultSecret").mockRejectedValue(Object.assign(new Error("fixture missing"),{code:"VAULT_SECRET_NOT_FOUND"}));
    const fetch=vi.fn(async(url:unknown,init?:RequestInit)=>{
      const isResponses=String(url).endsWith("/responses"),request=JSON.parse(String(init?.body));
      if(isResponses&&protocol==="chat-fallback")return new Response(JSON.stringify({error:{message:"unsupported endpoint"}}),{status:404,headers:{"Content-Type":"application/json"}});
      const system=isResponses?request.input[0].content[0].text:request.messages[0].content;
      const marker="Return JSON matching this exact schema:",schemaText=system.includes(marker)?system.slice(system.indexOf(marker)+marker.length).trim():undefined;
      const schemaKnown=schemaText&&JSON.stringify(JSON.parse(schemaText))===JSON.stringify(jsonSchemas.evaluate.schema);
      const output=JSON.stringify(schemaKnown?report:{summary:"valid JSON without required evaluation fields"});
      return new Response(JSON.stringify(isResponses?{status:"completed",output_text:output}:{choices:[{message:{role:"assistant",content:output},finish_reason:"stop"}]}),{status:200,headers:{"Content-Type":"application/json"}});
    });vi.stubGlobal("fetch",fetch);
    expect(await runServerAi("evaluate",payload)).toEqual(report);expect(fetch).toHaveBeenCalledTimes(protocol==="chat-fallback"?2:1);
  });
});

describe("schema instruction scoring identity and validation",()=>{
  it.each(["json-schema","json-object","prompt-json"] as const)("binds schema prompt and correction policy for %s",async(responseFormat)=>{
    const config={connectionId:"fixture-connection",label:"Synthetic direct model",baseUrl:"https://model.example.test/v1",apiKey:"fixture-key",model:"fixture-model",protocol:"chat-completions" as const,responseFormat};
    const base={route:["openai-compatible",config.baseUrl,config.model,config.protocol,responseFormat],semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,chatOutputVersion:COMPATIBLE_CHAT_OUTPUT_VERSION};
    const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const current=await withExplicitServerAiConnection(config,()=>serverAiScoringRouteFingerprint());
    expect(current).toBe(hash({...base,...(responseFormat==="json-schema"?{directSchemaInstructionVersion:DIRECT_AI_SCHEMA_INSTRUCTION_VERSION}:{}),directSchemaRecoveryVersion:DIRECT_AI_SCHEMA_RECOVERY_VERSION}));
    expect(current).not.toBe(hash({...base,...(responseFormat==="json-schema"?{directSchemaInstructionVersion:DIRECT_AI_SCHEMA_INSTRUCTION_VERSION}:{})}));
  });
  it.each(["chat-completions","responses"] as const)("still rejects missing evaluation fields on %s",async(protocol)=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(protocol==="chat-completions"?{choices:[{message:{role:"assistant",content:JSON.stringify({summary:"incomplete task JSON"})},finish_reason:"stop"}]}:{status:"completed",output_text:JSON.stringify({summary:"incomplete task JSON"})}),{status:200,headers:{"Content-Type":"application/json"}})));
    await expect(withExplicitServerAiConnection({connectionId:"fixture-connection",label:"Synthetic direct model",baseUrl:"https://model.example.test/v1",apiKey:"fixture-key",model:"fixture-model",protocol,responseFormat:"json-schema"},()=>runServerAi("evaluate",payload))).rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});
  });
});
