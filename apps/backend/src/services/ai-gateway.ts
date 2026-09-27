import type { ZodType } from "zod";
import { createHash } from "node:crypto";
import {
  AiOperationSchema,
  ArtifactAcceptanceAiResultSchema,
  BuildCandidateAiResultSchema,
  CommandAiResultSchema,
  CopilotAiResultSchema,
  DistillAiResultSchema,
  DiagnosisAiResultSchema,
  EvalSuiteAiResultSchema,
  EvaluateAiResultSchema,
  ExecuteArtifactAiResultSchema,
  ExecuteArtifactBatchAiResultSchema,
  GapAdviceAiResultSchema,
  GapClusterAiResultSchema,
  IntakeAiResultSchema,
  MaterializeAiResultSchema,
  NextQueueAiResultSchema,
  PlanAiResultSchema,
  PopulationEvaluationAiResultSchema,
  ProblemAnalysisAiResultSchema,
  RepairArtifactAiResultSchema,
  ReleaseReviewAiResultSchema,
  RubricAiResultSchema,
  TargetAiResultSchema,
  UnderstandAiResultSchema,
  VisualJudgeAiResultSchema,
  jsonSchemas,
  type AiOperation,
  type ArtifactAcceptanceAiResult,
  type BuildCandidateAiResult,
  type CommandAiResult,
  type CopilotAiResult,
  type DistillAiResult,
  type DiagnosisAiResult,
  type EvalSuiteAiResult,
  type EvaluateAiResult,
  type ExecuteArtifactAiResult,
  type ExecuteArtifactBatchAiResult,
  type GapAdviceAiResult,
  type GapClusterAiResult,
  type IntakeAiResult,
  type MaterializeAiResult,
  type NextQueueAiResult,
  type PlanAiResult,
  type PopulationEvaluationAiResult,
  type ProblemAnalysisAiResult,
  type RepairArtifactAiResult,
  type ReleaseReviewAiResult,
  type RubricAiResult,
  type TargetAiResult,
  type UnderstandAiResult,
  type VisualJudgeAiResult,
} from "@evolution/contracts";
import { getServerAiConfig } from "../server-env";

export type ServerAiOperation=AiOperation;
/** Public scoring-route identity; API keys and timeout settings are deliberately excluded. */
export function serverAiScoringRouteFingerprint(): string | undefined {
  const config = getServerAiConfig();
  if (!config) return undefined;
  const route = config.mode === "openai-compatible"
    ? [config.mode, config.baseUrl, config.model]
    : [config.mode, config.model];
  return createHash("sha256").update(JSON.stringify(route)).digest("hex");
}

type StructuredSchema={name:string;schema:Record<string,unknown>};
type Contract<T>={schema:StructuredSchema;parser:ZodType<T>;instruction:string};
export type ServerAiMedia={imageDataUrls?:string[]};
type ParsedImage={dataUrl:string;base64:string;mediaType:string};
const MAX_AI_IMAGES=4;
const MAX_AI_IMAGE_BYTES=4*1024*1024;

function parseServerAiImages(media?:ServerAiMedia):ParsedImage[]{
  const values=media?.imageDataUrls??[];
  if(values.length>MAX_AI_IMAGES)throw new Error(`Server AI 最多接受 ${MAX_AI_IMAGES} 张图片`);
  return values.map((dataUrl,index)=>{
    const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if(!match)throw new Error(`Server AI 图片 ${index+1} 必须是 PNG/JPEG/WebP data URL`);
    const base64=match[2]!;
    if(Buffer.byteLength(base64,"base64")>MAX_AI_IMAGE_BYTES)throw new Error(`Server AI 图片 ${index+1} 超过 4MB`);
    return{dataUrl,base64,mediaType:match[1]!};
  });
}

async function loadVercelAiSdk(){
  // Keep @ai-sdk/gateway out of the shared Nitro function bootstrap. On Vercel,
  // eager evaluation can make unrelated API routes fail before their handler runs.
  return import("ai");
}

const SYSTEM=[
  "You are Evolve Studio's server-side evolution engine.",
  "Use only the supplied Mission evidence. Never invent source facts, measured improvements, or verification.",
  "Preserve the user's explicit requirements and protected scope.",
  "Return only JSON matching the requested schema. Use concise business-readable Chinese.",
].join("\n");

function contract(operation:ServerAiOperation):Contract<unknown>{
  if(operation==="intake")return{schema:jsonSchemas.intake,parser:IntakeAiResultSchema,instruction:"Understand the user command and parsed artifact evidence. Infer the semantic business object, exactly six workflow stages, a compact acceptance rubric, goals, metrics, protected/editable scope, risks and artifact summaries. Parsing/runtime limitations are not product defects; never claim unseen evidence."};
  if(operation==="understand")return{schema:jsonSchemas.understand,parser:UnderstandAiResultSchema,instruction:"Deeply understand supplied command and artifact evidence. Restate intent, implicit requirements, assumptions, material clarifications, acceptance focus and confidence. Do not ask about parser/runtime capability."};
  if(operation==="command")return{schema:jsonSchemas.command,parser:CommandAiResultSchema,instruction:"Interpret the new command against current mission and artifact evidence. Preserve prior intent unless explicitly changed and return the consolidated command, scope additions and safe next action."};
  if(operation==="target")return{schema:jsonSchemas.target,parser:TargetAiResultSchema,instruction:"Compile source understanding and command into an executable target contract with goal, metrics, protected/editable scope, acceptance criteria and risks. Use only supplied evidence."};
  if(operation==="rubric")return{schema:jsonSchemas.rubric,parser:RubricAiResultSchema,instruction:"Compile a compact project-specific Acceptance Rubric from user intent, business object, protected scope, artifact structures and current goal. Criteria are user/business outcomes, not parser details."};
  if(operation==="eval-suite")return{schema:jsonSchemas.evalSuite,parser:EvalSuiteAiResultSchema,instruction:"Create a compact discriminative Eval Suite mapped to the Acceptance Rubric. Cover every criterion and hard gate with truthful execution modes."};
  if(operation==="build-candidate")return{schema:jsonSchemas.buildCandidate,parser:BuildCandidateAiResultSchema,instruction:"Construct exact Candidate artifacts from the CURRENT target version and Candidate plan. Preserve protected/untouched scope; never claim tests passed."};
  if(operation==="execute-artifact")return{schema:jsonSchemas.executeArtifact,parser:ExecuteArtifactAiResultSchema,instruction:"Inspect or execute one supplied current artifact against the test intent. Return concrete output/trace from supplied evidence; say UNVERIFIED when behavior cannot be established."};
  if(operation==="repair-artifact")return{schema:jsonSchemas.repairArtifact,parser:RepairArtifactAiResultSchema,instruction:"Repair only explicitly supplied VERIFIED failed criteria on exact current Candidate artifacts. Preserve unrelated/protected behavior; never claim validation passed."};
  if(operation==="execute-artifact-batch")return{schema:jsonSchemas.executeArtifactBatch,parser:ExecuteArtifactBatchAiResultSchema,instruction:"Inspect CURRENT artifact evidence against each supplied test. Return concrete observations only; missing evidence is UNVERIFIED, not invented failure."};
  if(operation==="evaluate-population")return{schema:jsonSchemas.evaluatePopulation,parser:PopulationEvaluationAiResultSchema,instruction:"Compare the candidate population only from measured evidence. Score every candidate and enforce hard gates/safety without treating missing evidence as product failure."};
  if(operation==="artifact-acceptance")return{schema:jsonSchemas.artifactAcceptance,parser:ArtifactAcceptanceAiResultSchema,instruction:"Perform Gate F acceptance on exact supplied Candidate artifacts. Return every supplied criterion result and truthful coverage/integrity/pairwise/hard-gate conclusions."};
  if(operation==="materialize")return{schema:jsonSchemas.materialize,parser:MaterializeAiResultSchema,instruction:"Materialize only supplied accepted content, preserving sourceArtifactId and exact accepted content. Do not regenerate a different deliverable or claim unsupported binary fidelity."};
  if(operation==="evaluate")return{schema:jsonSchemas.evaluate,parser:EvaluateAiResultSchema,instruction:"Act as an independent evidence judge. Score only supplied current-artifact runs/criteria. Missing evidence is not product failure and must not be invented."};
  if(operation==="problem-analysis")return{schema:jsonSchemas.problemAnalysis,parser:ProblemAnalysisAiResultSchema,instruction:"Analyze measured Baseline and current artifact evidence. Return only concrete user/business problems supported by supplied evidence; capability limitations are not product defects."};
  if(operation==="diagnose")return{schema:jsonSchemas.diagnosis,parser:DiagnosisAiResultSchema,instruction:"Diagnose the selected problem from supplied Baseline/source/traces. Give evidence, counter-evidence and falsifier; do not invent implementation facts."};
  if(operation==="plan")return{schema:jsonSchemas.plan,parser:PlanAiResultSchema,instruction:"Generate a small diverse Candidate population for the selected diagnosed problem. Ground every design rationale in supplied evidence and never claim measured improvement before experiment."};
  if(operation==="release-review")return{schema:jsonSchemas.releaseReview,parser:ReleaseReviewAiResultSchema,instruction:"Perform final release review from measured evidence/deterministic checks only. Release only when supplied hard gates/evidence requirements are satisfied."};
  if(operation==="distill")return{schema:jsonSchemas.distill,parser:DistillAiResultSchema,instruction:"Distill the causal lesson. Verified-skill requires fresh, live, stable-healthy Production Outcome; stale/degrading/flapping evidence cannot justify it."};
  if(operation==="next-queue")return{schema:jsonSchemas.nextQueue,parser:NextQueueAiResultSchema,instruction:"Generate the next Evolution Queue from remaining failures, lessons, uncertainty, edge cases and business value. Do not invent production failures."};
  if(operation==="copilot")return{schema:jsonSchemas.copilot,parser:CopilotAiResultSchema,instruction:"Answer as mission copilot from supplied current state/evidence and suggest only safe executable actions."};
  if(operation==="gap-cluster")return{schema:jsonSchemas.gapCluster,parser:GapClusterAiResultSchema,instruction:"Cluster measured validation gaps by common observable failure pattern. Keep caseIds grounded and give concrete remediation."};
  if(operation==="gap-advice")return{schema:jsonSchemas.gapAdvice,parser:GapAdviceAiResultSchema,instruction:"Translate measured experiment/validation gaps into concrete next modifications. Do not invent causes, scores or production failures."};
  if(operation==="visual-judge")return{schema:jsonSchemas.visualJudge,parser:VisualJudgeAiResultSchema,instruction:"Judge only supplied rendered visual evidence for usability, aesthetics, responsiveness and interaction. Do not infer unseen states."};
  const exhaustive:never=operation;
  throw new Error("Unsupported Server AI operation: "+exhaustive);
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
  images:ParsedImage[];
}){
  const {Output,generateText,gateway}=await loadVercelAiSdk();
  const generated=await generateText({
    model:gateway(args.config.model),
    system:SYSTEM+"\n\nTask: "+args.contract.instruction,
    messages:[{
      role:"user" as const,
      content:args.images.length
        ?[
            {type:"text" as const,text:JSON.stringify(args.payload)},
            ...args.images.map((image)=>({type:"image" as const,image:image.base64,mediaType:image.mediaType})),
          ]
        :JSON.stringify(args.payload),
    }],
    output:Output.object({
      schema:args.contract.parser,
      name:args.contract.schema.name,
    }),
    maxOutputTokens:10_000,
    timeout:args.config.timeoutMs,
  });
  return args.contract.parser.parse(generated.output);
}

async function callResponses<T>(args:{config:Extract<NonNullable<ReturnType<typeof getServerAiConfig>>,{mode:"openai-compatible"}>;contract:Contract<T>;payload:unknown;images:ParsedImage[]}){
  const response=await fetch(args.config.baseUrl+"/responses",{
    method:"POST",
    signal:AbortSignal.timeout(args.config.timeoutMs),
    headers:{Authorization:"Bearer "+args.config.apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:args.config.model,
      store:false,
      input:[
        {role:"system",content:[{type:"input_text",text:SYSTEM+"\n\nTask: "+args.contract.instruction}]},
        {role:"user",content:[
          {type:"input_text",text:JSON.stringify(args.payload)},
          ...args.images.map((image)=>({type:"input_image",image_url:image.dataUrl})),
        ]},
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

async function callChat<T>(args:{config:Extract<NonNullable<ReturnType<typeof getServerAiConfig>>,{mode:"openai-compatible"}>;contract:Contract<T>;payload:unknown;images:ParsedImage[]}){
  const response=await fetch(args.config.baseUrl+"/chat/completions",{
    method:"POST",
    signal:AbortSignal.timeout(args.config.timeoutMs),
    headers:{Authorization:"Bearer "+args.config.apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:args.config.model,
      messages:[
        {role:"system",content:SYSTEM+"\n\nTask: "+args.contract.instruction},
        {role:"user",content:args.images.length?[
          {type:"text",text:JSON.stringify(args.payload)},
          ...args.images.map((image)=>({type:"image_url",image_url:{url:image.dataUrl}})),
        ]:JSON.stringify(args.payload)},
      ],
      response_format:{type:"json_schema",json_schema:{name:args.contract.schema.name,strict:true,schema:args.contract.schema.schema}},
    }),
  });
  const json=await response.json().catch(()=>({})) as ChatJson;
  if(!response.ok)throw new Error(json.error?.message||("Server AI Chat HTTP "+response.status));
  return args.contract.parser.parse(JSON.parse(chatText(json)));
}

async function structured<T>(payload:unknown,schema:Contract<T>,media?:ServerAiMedia):Promise<T>{
  const config=getServerAiConfig();
  if(!config){
    throw Object.assign(
      new Error("Server AI 未配置：请使用 Vercel OIDC/AI Gateway，或配置 OpenAI-compatible API Key + Model"),
      {code:"SERVER_AI_UNAVAILABLE"},
    );
  }
  const images=parseServerAiImages(media);
  if(config.mode==="vercel-gateway"){
    return callVercelGateway({config,contract:schema,payload,images});
  }
  try{
    return await callResponses({config,contract:schema,payload,images});
  }catch(error){
    const status=(error as {httpStatus?:number}).httpStatus;
    if(status!==404&&status!==405&&status!==400)throw error;
    return callChat({config,contract:schema,payload,images});
  }
}

export function runServerAi(operation:"intake",payload:unknown):Promise<IntakeAiResult>;
export function runServerAi(operation:"understand",payload:unknown):Promise<UnderstandAiResult>;
export function runServerAi(operation:"command",payload:unknown):Promise<CommandAiResult>;
export function runServerAi(operation:"target",payload:unknown):Promise<TargetAiResult>;
export function runServerAi(operation:"rubric",payload:unknown):Promise<RubricAiResult>;
export function runServerAi(operation:"eval-suite",payload:unknown):Promise<EvalSuiteAiResult>;
export function runServerAi(operation:"build-candidate",payload:unknown):Promise<BuildCandidateAiResult>;
export function runServerAi(operation:"execute-artifact",payload:unknown):Promise<ExecuteArtifactAiResult>;
export function runServerAi(operation:"repair-artifact",payload:unknown):Promise<RepairArtifactAiResult>;
export function runServerAi(operation:"execute-artifact-batch",payload:unknown):Promise<ExecuteArtifactBatchAiResult>;
export function runServerAi(operation:"evaluate-population",payload:unknown):Promise<PopulationEvaluationAiResult>;
export function runServerAi(operation:"artifact-acceptance",payload:unknown):Promise<ArtifactAcceptanceAiResult>;
export function runServerAi(operation:"materialize",payload:unknown):Promise<MaterializeAiResult>;
export function runServerAi(operation:"evaluate",payload:unknown):Promise<EvaluateAiResult>;
export function runServerAi(operation:"problem-analysis",payload:unknown):Promise<ProblemAnalysisAiResult>;
export function runServerAi(operation:"diagnose",payload:unknown):Promise<DiagnosisAiResult>;
export function runServerAi(operation:"plan",payload:unknown):Promise<PlanAiResult>;
export function runServerAi(operation:"release-review",payload:unknown):Promise<ReleaseReviewAiResult>;
export function runServerAi(operation:"distill",payload:unknown):Promise<DistillAiResult>;
export function runServerAi(operation:"next-queue",payload:unknown):Promise<NextQueueAiResult>;
export function runServerAi(operation:"copilot",payload:unknown):Promise<CopilotAiResult>;
export function runServerAi(operation:"gap-cluster",payload:unknown):Promise<GapClusterAiResult>;
export function runServerAi(operation:"gap-advice",payload:unknown):Promise<GapAdviceAiResult>;
export function runServerAi(operation:"visual-judge",payload:unknown,media?:ServerAiMedia):Promise<VisualJudgeAiResult>;
export function runServerAi(operation:AiOperation,payload:unknown,media?:ServerAiMedia):Promise<unknown>;
export function runServerAi(operation:ServerAiOperation,payload:unknown,media?:ServerAiMedia){
  AiOperationSchema.parse(operation);
  return structured(payload,contract(operation),media);
}

function serverAiErrorChain(error:unknown){
  const chain:unknown[]=[];
  let current=error;
  for(let depth=0;depth<6&&current&&typeof current==="object";depth+=1){
    chain.push(current);
    current=(current as {cause?:unknown}).cause;
  }
  return chain;
}

export function serverAiUnavailableReason(error:unknown):string|undefined{
  const chain=serverAiErrorChain(error);
  for(const item of chain){
    if((item as {code?:string}).code==="SERVER_AI_UNAVAILABLE")return "not-configured";
  }
  const text=chain.map((item)=>item instanceof Error?item.message:String(item)).join(" | ").toLowerCase();
  if(/customer_verification_required|valid credit card|add-credit-card|credit card on file/.test(text))return "customer-verification-required";
  const statuses=chain.flatMap((item)=>{
    const value=item as {status?:number;statusCode?:number;httpStatus?:number};
    return [value.status,value.statusCode,value.httpStatus].filter((status):status is number=>typeof status==="number");
  });
  if(statuses.some((status)=>status===401||status===402||status===403))return "provider-auth-or-billing";
  if(statuses.some((status)=>status===429)||/rate.?limit|quota|insufficient (?:credit|balance)|billing/.test(text))return "provider-rate-limit";
  if(statuses.some((status)=>status===502||status===503||status===504))return "provider-unavailable";
  return undefined;
}

export function serverAiUnavailableMessage(reasonCode:string){
  if(reasonCode==="customer-verification-required")return "Vercel AI Gateway 已配置，但团队尚未完成信用卡/账户验证；请改用真实 BYOK，或之后完成 Vercel AI Gateway 计费验证。";
  if(reasonCode==="provider-auth-or-billing")return "Server AI Provider 鉴权或计费不可用；请检查服务端 Provider 配置，或改用真实 BYOK。";
  if(reasonCode==="provider-rate-limit")return "Server AI Provider 当前额度/频率受限；请稍后重试或改用真实 BYOK。";
  if(reasonCode==="provider-unavailable")return "Server AI Provider 当前不可用；请稍后重试或改用真实 BYOK。";
  return "Server AI 未配置或当前不可用；请配置真实 Server AI / BYOK 后重试。";
}

export function isServerAiUnavailable(error:unknown){
  return Boolean(serverAiUnavailableReason(error));
}
