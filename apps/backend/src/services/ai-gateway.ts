import { Output, generateText, gateway } from "ai";
import type { ZodType } from "zod";
import {
  DistillAiResultSchema,
  EvalSuiteAiResultSchema,
  NextQueueAiResultSchema,
  RubricAiResultSchema,
  UnderstandAiResultSchema,
  jsonSchemas,
  type DistillAiResult,
  type EvalSuiteAiResult,
  type NextQueueAiResult,
  type RubricAiResult,
  type UnderstandAiResult,
} from "@evolution/contracts";
import { getServerAiConfig } from "../server-env";

export type ServerAiOperation="understand"|"rubric"|"eval-suite"|"distill"|"next-queue";

type StructuredSchema={name:string;schema:Record<string,unknown>};
type Contract<T>={schema:StructuredSchema;parser:ZodType<T>;instruction:string};

const SYSTEM=[
  "You are Evolve Studio's server-side evolution engine.",
  "Use only the supplied Mission evidence. Never invent source facts, measured improvements, or verification.",
  "Preserve the user's explicit requirements and protected scope.",
  "Return only JSON matching the requested schema. Use concise business-readable Chinese.",
].join("\n");

function contract(operation:"understand"):Contract<UnderstandAiResult>;
function contract(operation:"rubric"):Contract<RubricAiResult>;
function contract(operation:"eval-suite"):Contract<EvalSuiteAiResult>;
function contract(operation:"distill"):Contract<DistillAiResult>;
function contract(operation:"next-queue"):Contract<NextQueueAiResult>;
function contract(operation:ServerAiOperation):Contract<UnderstandAiResult|RubricAiResult|EvalSuiteAiResult|DistillAiResult|NextQueueAiResult>{
  if(operation==="understand")return{
    schema:jsonSchemas.understand,
    parser:UnderstandAiResultSchema,
    instruction:"Deeply understand the supplied command and artifact evidence. Restate true intent, implicit requirements, explicit assumptions, at most four material clarifications with safe defaults, observable acceptance focus, and confidence. Do not ask about parser/runtime capability.",
  };
  if(operation==="rubric")return{
    schema:jsonSchemas.rubric,
    parser:RubricAiResultSchema,
    instruction:"Compile a compact project-specific Acceptance Rubric from user intent, business object, protected scope, artifact structures and current goal. Criteria must be user/business outcomes, not parser or implementation details. Choose truthful validationMethod and hard gates.",
  };
  if(operation==="eval-suite")return{
    schema:jsonSchemas.evalSuite,
    parser:EvalSuiteAiResultSchema,
    instruction:"Create a compact discriminative Eval Suite mapped to the supplied Acceptance Rubric. Every test must include criterionIds, executionMode and evidenceScope. Cover every criterion and every hard gate in hidden holdout. Do not invent selectors or runtime capabilities.",
  };
  if(operation==="distill")return{
    schema:jsonSchemas.distill,
    parser:DistillAiResultSchema,
    instruction:"Distill the causal lesson from source, baseline, accepted winner, validation and release evidence. Only call it verified-skill when real evidence supports reuse; otherwise return lesson or anti-pattern. State effect, limit, triggers, method and validation surfaces.",
  };
  return{
    schema:jsonSchemas.nextQueue,
    parser:NextQueueAiResultSchema,
    instruction:"Generate the next Evolution Queue from remaining failures, lessons, uncertainty, edge cases and business value. Return concrete priorities and measurable suggested metrics. Do not invent production failures.",
  };
}

type ResponsesJson={
  status?:string;
  output_text?:string;
  output?:Array<{content?:Array<{type?:string;text?:string}>}>;
  error?:{message?:string}|null;
};
type ChatJson={
  choices?:Array<{message?:{content?:string|Array<{type?:string;text?:string}>}}>;
  error?:{message?:string}|null;
};

function responseText(json:ResponsesJson){
  if(typeof json.output_text==="string"&&json.output_text.trim())return json.output_text;
  for(const item of json.output??[])for(const part of item.content??[]){
    if(part.type==="output_text"&&typeof part.text==="string"&&part.text.trim())return part.text;
  }
  throw new Error("Server AI response missing output_text");
}

function chatText(json:ChatJson){
  const value=json.choices?.[0]?.message?.content;
  if(typeof value==="string"&&value.trim())return value;
  if(Array.isArray(value)){
    const joined=value.map((item)=>item.text??"").join("").trim();
    if(joined)return joined;
  }
  throw new Error("Server AI chat response missing content");
}

async function callVercelGateway<T>(args:{
  config:Extract<NonNullable<ReturnType<typeof getServerAiConfig>>,{mode:"vercel-gateway"}>;
  contract:Contract<T>;
  payload:unknown;
}){
  const generated=await generateText({
    model:gateway(args.config.model),
    system:SYSTEM+"\n\nTask: "+args.contract.instruction,
    prompt:JSON.stringify(args.payload),
    output:Output.object({
      schema:args.contract.parser,
      name:args.contract.schema.name,
    }),
    maxOutputTokens:10_000,
    timeout:args.config.timeoutMs,
  });
  return args.contract.parser.parse(generated.output);
}

async function callResponses<T>(args:{config:Extract<NonNullable<ReturnType<typeof getServerAiConfig>>,{mode:"openai-compatible"}>;contract:Contract<T>;payload:unknown}){
  const response=await fetch(args.config.baseUrl+"/responses",{
    method:"POST",
    signal:AbortSignal.timeout(args.config.timeoutMs),
    headers:{Authorization:"Bearer "+args.config.apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:args.config.model,
      store:false,
      input:[
        {role:"system",content:[{type:"input_text",text:SYSTEM+"\n\nTask: "+args.contract.instruction}]},
        {role:"user",content:[{type:"input_text",text:JSON.stringify(args.payload)}]},
      ],
      max_output_tokens:10000,
      text:{format:{type:"json_schema",name:args.contract.schema.name,strict:true,schema:args.contract.schema.schema}},
    }),
  });
  const json=await response.json().catch(()=>({})) as ResponsesJson;
  if(!response.ok){
    const error=Object.assign(new Error(json.error?.message||("Server AI Responses HTTP "+response.status)),{httpStatus:response.status});
    throw error;
  }
  if(json.status&&json.status!=="completed")throw new Error("Server AI response status: "+json.status);
  return args.contract.parser.parse(JSON.parse(responseText(json)));
}

async function callChat<T>(args:{config:Extract<NonNullable<ReturnType<typeof getServerAiConfig>>,{mode:"openai-compatible"}>;contract:Contract<T>;payload:unknown}){
  const response=await fetch(args.config.baseUrl+"/chat/completions",{
    method:"POST",
    signal:AbortSignal.timeout(args.config.timeoutMs),
    headers:{Authorization:"Bearer "+args.config.apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:args.config.model,
      messages:[
        {role:"system",content:SYSTEM+"\n\nTask: "+args.contract.instruction},
        {role:"user",content:JSON.stringify(args.payload)},
      ],
      response_format:{type:"json_schema",json_schema:{name:args.contract.schema.name,strict:true,schema:args.contract.schema.schema}},
    }),
  });
  const json=await response.json().catch(()=>({})) as ChatJson;
  if(!response.ok)throw new Error(json.error?.message||("Server AI Chat HTTP "+response.status));
  return args.contract.parser.parse(JSON.parse(chatText(json)));
}

async function structured<T>(payload:unknown,schema:Contract<T>):Promise<T>{
  const config=getServerAiConfig();
  if(!config){
    throw Object.assign(
      new Error("Server AI 未配置：请使用 Vercel OIDC/AI Gateway，或配置 OpenAI-compatible API Key + Model"),
      {code:"SERVER_AI_UNAVAILABLE"},
    );
  }
  if(config.mode==="vercel-gateway"){
    return callVercelGateway({config,contract:schema,payload});
  }
  try{
    return await callResponses({config,contract:schema,payload});
  }catch(error){
    const status=(error as {httpStatus?:number}).httpStatus;
    if(status!==404&&status!==405&&status!==400)throw error;
    return callChat({config,contract:schema,payload});
  }
}

export function runServerAi(operation:"understand",payload:unknown):Promise<UnderstandAiResult>;
export function runServerAi(operation:"rubric",payload:unknown):Promise<RubricAiResult>;
export function runServerAi(operation:"eval-suite",payload:unknown):Promise<EvalSuiteAiResult>;
export function runServerAi(operation:"distill",payload:unknown):Promise<DistillAiResult>;
export function runServerAi(operation:"next-queue",payload:unknown):Promise<NextQueueAiResult>;
export function runServerAi(operation:ServerAiOperation,payload:unknown){
  if(operation==="understand")return structured(payload,contract("understand"));
  if(operation==="rubric")return structured(payload,contract("rubric"));
  if(operation==="eval-suite")return structured(payload,contract("eval-suite"));
  if(operation==="distill")return structured(payload,contract("distill"));
  return structured(payload,contract("next-queue"));
}

export function isServerAiUnavailable(error:unknown){
  return (error as {code?:string})?.code==="SERVER_AI_UNAVAILABLE";
}
