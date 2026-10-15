// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {jsonSchemas} from "@evolution/contracts";
import {runServerAi,serverAiScoringRouteFingerprint,DIRECT_AI_SCHEMA_INSTRUCTION_VERSION,DIRECT_AI_SCHEMA_RECOVERY_VERSION} from "./ai-gateway";
import {probeServerAiRuntime,resetServerAiRuntimeProbeCache} from "./server-ai-health";
import {createHash} from "node:crypto";
import {COMPATIBLE_CHAT_OUTPUT_VERSION,STRUCTURED_AI_FINAL_OUTPUT_VERSION} from "@evolution/adapters";
import {SERVER_SEMANTIC_CONTEXT_VERSION} from "@evolution/harness";
import {HTML_PROTECTION_SETTLEMENT_POLICY} from "@evolution/core";
import {INDEPENDENT_EVALUATION_SAFETY_INSTRUCTION_VERSION} from "./independent-evaluation-safety";
import {MINIMAX_CHAT_FINAL_CHANNEL_VERSION} from "./minimax-chat-final-channel";
import {MINIMAX_SCHEMA_TOOL_VERSION} from "./minimax-schema-tool";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const selected={connectionId:"native-schema-fixture",label:"Synthetic",apiKey:"fictional-native-key",baseUrl:"https://api.minimaxi.com/v1",model:"MiniMax-M2.7-highspeed",protocol:"chat-completions" as const,responseFormat:"json-schema" as const};
const payload={project:{goal:"Synthetic schema-carrier check",sourceArtifacts:[{id:"synthetic",textContent:'Preserve literal quotes "value", slash \\ and newline\n.'}]}};
const output={intentRestatement:'Synthetic final "quoted" \\ value\nnext line',implicitRequirements:[],assumptions:[],clarifications:[],acceptanceFocus:[],confidence:0.9};
function reply(args:string,name:string=jsonSchemas.understand.name){return new Response(JSON.stringify({choices:[{finish_reason:"tool_calls",message:{role:"assistant",content:null,reasoning_content:"private synthetic reasoning",tool_calls:[{id:"call_synthetic",type:"function",function:{name,arguments:args}}]}}]}));}
function intercept(make:(body:Record<string,unknown>,i:number)=>Response){const requests:Array<{url:string;init:RequestInit;body:Record<string,unknown>}>=[];vi.stubGlobal("fetch",vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));requests.push({url:String(url),init:init!,body});return make(body,requests.length);}));return requests;}
afterEach(()=>vi.unstubAllGlobals());
describe("MiniMax JSON Schema native result carrier",()=>{
  it.each(["api.minimaxi.com","api.minimax.io","api.minimax.cn"].flatMap(host=>["MiniMax-M2.7","MiniMax-M2.7-highspeed"].map(model=>({host,model}))))("reads one requested schema function result on $host / $model",async({host,model})=>{
    const requests=intercept(()=>reply(JSON.stringify(output)));
    expect(await withExplicitServerAiConnection({...selected,baseUrl:'https://'+host+'/v1',model},()=>runServerAi("understand",payload))).toEqual(output);
    expect(requests).toHaveLength(1);const body=requests[0]!.body;
    expect(body.tools).toEqual([{type:"function",function:{name:jsonSchemas.understand.name,description:expect.any(String),parameters:jsonSchemas.understand.schema}}]);
    expect(body.tool_choice).toBe("auto");expect(body.reasoning_split).toBe(true);expect(body).not.toHaveProperty("response_format");
    expect((body.messages as Array<{content:string}>)[1]!.content).toBe(JSON.stringify(payload));
  });
  it("keeps the complete rejected arguments private for the same single correction",async()=>{
    const rejected='{"intentRestatement":"bad '+String.fromCharCode(10)+'json"}';
    const requests=intercept((_body,i)=>reply(i===1?rejected:JSON.stringify(output)));
    expect(await withExplicitServerAiConnection(selected,()=>runServerAi("understand",payload))).toEqual(output);
    expect(requests).toHaveLength(2);expect(requests[0]!.url).toBe(requests[1]!.url);expect(requests[0]!.init.signal).toBe(requests[1]!.init.signal);
    expect(requests[0]!.body.tools).toEqual(requests[1]!.body.tools);expect(requests[1]!.body.tool_choice).toBe("auto");
    const messages=requests.map(x=>x.body.messages as Array<{content:string}>);expect(messages[0]![1]!.content).toBe(messages[1]![1]!.content);
    expect(JSON.parse(messages[1]![2]!.content).rejectedFinalText).toBe(rejected);
  });
});

describe("native schema carrier retains independent evaluation semantics",()=>{
  it.each(["REVIEW","FAIL","PASS"])("returns valid Safety %s once with all nine literal cases and criteria",async safety=>{
    const cases=Array.from({length:9},(_,i)=>({testCaseId:"HC-"+i,accuracy:80,evidence:80,completeness:80,reason:'observed "literal" \\ line\nnext'}));
    const criteria=cases.map((c,i)=>({criterionId:"criterion-"+i,score:80,pass:false,evidence:["synthetic observation"],gaps:["synthetic deficit"],testCaseIds:[c.testCaseId]}));
    const report={accuracy:80,evidence:80,riskCoverage:80,completeness:80,safety,notes:["synthetic only"],failures:["observed deficit"],cases,criteria};
    const requests=intercept(()=>reply(JSON.stringify(report),jsonSchemas.evaluate.name));
    expect(await withExplicitServerAiConnection(selected,()=>runServerAi("evaluate",{acceptanceRubric:criteria,testCases:cases}))).toEqual(report);
    expect(requests).toHaveLength(1);expect(requests[0]!.body.tools).toEqual([{type:"function",function:{name:jsonSchemas.evaluate.name,description:expect.any(String),parameters:jsonSchemas.evaluate.schema}}]);
  });
  it("does not accept semantically invalid duplicate case IDs or grant a correction",async()=>{
    const report={accuracy:80,evidence:80,riskCoverage:80,completeness:80,safety:"REVIEW",cases:[{testCaseId:"same",accuracy:80,evidence:80,completeness:80},{testCaseId:"same",accuracy:80,evidence:80,completeness:80}],criteria:[]};
    const requests=intercept(()=>reply(JSON.stringify(report),jsonSchemas.evaluate.name));
    await expect(withExplicitServerAiConnection(selected,()=>runServerAi("evaluate",{}))).rejects.toMatchObject({code:"AI_OUTPUT_SCHEMA_MISMATCH"});expect(requests).toHaveLength(1);
  });
  it("retains both invalid phases and argument byte counts without any excerpts or third call",async()=>{
    const rejected='{"private-marker":';const requests=intercept(()=>reply(rejected));
    const error=await withExplicitServerAiConnection(selected,()=>runServerAi("understand",payload)).catch(e=>e);
    expect(error.code).toBe("AI_OUTPUT_INVALID_JSON");expect(error.message).toContain("completionPhase=initial");expect(error.message).toContain("completionPhase=correction");expect(error.message).toContain("carrier=schema-tool");expect(error.message).toContain("contentBytes="+Buffer.byteLength(rejected));expect(error.message).not.toContain("private-marker");expect(requests).toHaveLength(2);
  });
  it("never forwards a rejected final containing the selected credential",async()=>{
    const requests=intercept(()=>reply('{"literal":"'+selected.apiKey+'"'));
    const error=await withExplicitServerAiConnection(selected,()=>runServerAi("understand",payload)).catch(e=>e);
    expect(error.code).toBe("AI_OUTPUT_CORRECTION_SECRET_PRESENT");expect(error.message).not.toContain(selected.apiKey);expect(requests).toHaveLength(1);
  });
  it("does not repair unsupported/wrong function calls",async()=>{
    const requests=intercept(()=>reply(JSON.stringify(output),"arbitrary_action"));
    await expect(withExplicitServerAiConnection(selected,()=>runServerAi("understand",payload))).rejects.toMatchObject({code:"AI_OUTPUT_MISSING_FINAL"});expect(requests).toHaveLength(1);
  });
  it("can consume ordinary complete final text from the same native response",async()=>{
    const requests=intercept(()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]})));
    expect(await withExplicitServerAiConnection(selected,()=>runServerAi("understand",payload))).toEqual(output);expect(requests).toHaveLength(1);
  });
});
function fingerprint(config:typeof selected,version?:string){
  return createHash("sha256").update(JSON.stringify({route:["openai-compatible",config.baseUrl,config.model,config.protocol,config.responseFormat],protectionSettlementPolicy:HTML_PROTECTION_SETTLEMENT_POLICY,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,evaluationSafetyInstructionVersion:INDEPENDENT_EVALUATION_SAFETY_INSTRUCTION_VERSION,responsesOutputVersion:undefined,chatOutputVersion:COMPATIBLE_CHAT_OUTPUT_VERSION,directSchemaInstructionVersion:DIRECT_AI_SCHEMA_INSTRUCTION_VERSION,directSchemaRecoveryVersion:DIRECT_AI_SCHEMA_RECOVERY_VERSION,minimaxFinalChannelVersion:MINIMAX_CHAT_FINAL_CHANNEL_VERSION,minimaxSchemaToolVersion:version,finalOutputVersion:STRUCTURED_AI_FINAL_OUTPUT_VERSION})).digest("hex");
}
it("versions only native schema scoring and excludes credential rotation",async()=>{
  const actual=await withExplicitServerAiConnection(selected,serverAiScoringRouteFingerprint);
  expect(actual).toBe(fingerprint(selected,MINIMAX_SCHEMA_TOOL_VERSION));expect(actual).not.toBe(fingerprint(selected));
  expect(await withExplicitServerAiConnection({...selected,apiKey:"rotated-fixture"},serverAiScoringRouteFingerprint)).toBe(actual);
});

it("uses the normal server health probe without extracting the selected credential",async()=>{
  resetServerAiRuntimeProbeCache();const requests=intercept(()=>reply(JSON.stringify(output)));
  const health=await withExplicitServerAiConnection(selected,()=>probeServerAiRuntime(undefined,{isolated:true}));
  expect(health).toMatchObject({configured:true,ready:true,runtimeVerified:true});expect(requests).toHaveLength(1);
  expect(JSON.stringify(health)).not.toContain(selected.apiKey);const messages=requests[0]!.body.messages as Array<{content:string}>;
  expect(JSON.parse(messages[1]!.content)).toMatchObject({artifacts:[]});expect(messages[1]!.content).not.toContain(payload.project.sourceArtifacts[0]!.textContent);
});
