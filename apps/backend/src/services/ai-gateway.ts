import type { ZodType } from "zod";
import { aiProviderTransportFailure,parseStructuredAiOutput } from "@evolution/adapters";
import { createHash } from "node:crypto";
import {serverAiRepairContract} from "./server-ai-repair-contract";
import {serverAiBuildContract} from "./server-ai-build-contract";
import {ServerControlExecutionStoppedError,serverControlExecutionSignal} from "./server-control-execution";
import {
  AiOperationSchema,
  LessonDistillationContextSchema,
  ArtifactAcceptanceAiResultSchema,
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
import { SERVER_SEMANTIC_CONTEXT_VERSION,SERVER_MEASURED_REVIEW_VERSION } from "@evolution/harness";
import type { ServerAiConfig } from "../server-env";
import {resolveServerAiConfig} from "./server-ai-connection";
import {fetchServerAiProviderUsage,measureServerAiSdkUsage} from "./server-ai-usage";

export type ServerAiOperation=AiOperation;
/** Public scoring-route identity; API keys and timeout settings are deliberately excluded. */
export async function serverAiScoringRouteFingerprint(): Promise<string | undefined> {
  const config = await resolveServerAiConfig();
  if (!config) return undefined;
  const route = config.mode === "openai-compatible"
    ? [config.mode, config.baseUrl, config.model, ...(config.protocol || config.responseFormat ? [config.protocol,config.responseFormat] : []),...(config.reasoningEffort?[{reasoningEffort:config.reasoningEffort}]:[])]
    : [config.mode, config.model];
  return createHash("sha256").update(JSON.stringify({ route, semanticContextVersion: SERVER_SEMANTIC_CONTEXT_VERSION,measuredReviewVersion:SERVER_MEASURED_REVIEW_VERSION })).digest("hex");
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

function contract(operation:ServerAiOperation,payload:unknown):Contract<unknown>{
  if(operation==="intake")return{schema:jsonSchemas.intake,parser:IntakeAiResultSchema,instruction:"Understand the user command and parsed artifact evidence. Infer the semantic business object, exactly six workflow stages, a compact acceptance rubric, goals, metrics, protected/editable scope, risks and artifact summaries. Parsing/runtime limitations are not product defects; never claim unseen evidence."};
  if(operation==="understand")return{schema:jsonSchemas.understand,parser:UnderstandAiResultSchema,instruction:"Deeply understand supplied command and artifact evidence. Restate intent, implicit requirements, assumptions, material clarifications, acceptance focus and confidence. Do not ask about parser/runtime capability."};
  if(operation==="command")return{schema:jsonSchemas.command,parser:CommandAiResultSchema,instruction:"Interpret the new command against current mission and artifact evidence. Preserve prior intent unless explicitly changed and return the consolidated command, scope additions and safe next action."};
  if(operation==="target")return{schema:jsonSchemas.target,parser:TargetAiResultSchema,instruction:"Compile source understanding and command into an executable target contract with goal, metrics, protected/editable scope, acceptance criteria and risks. Use only supplied evidence."};
  if(operation==="rubric")return{schema:jsonSchemas.rubric,parser:RubricAiResultSchema,instruction:"Compile a compact project-specific Acceptance Rubric from user intent, business object, protected scope, artifact structures and current goal. Criteria are user/business outcomes, not parser details."};
  if(operation==="eval-suite")return{schema:jsonSchemas.evalSuite,parser:EvalSuiteAiResultSchema,instruction:"Create a compact discriminative Eval Suite mapped to the Acceptance Rubric: validationCases must contain 3-12 cases; hiddenCases must contain 2-8 cases. One case may cover multiple related criteria. Cover every criterion and hard gate with truthful execution modes."};
  if(operation==="build-candidate")return serverAiBuildContract(payload);
  if(operation==="execute-artifact")return{schema:jsonSchemas.executeArtifact,parser:ExecuteArtifactAiResultSchema,instruction:"Inspect or execute one supplied current artifact against the test intent. Return concrete output/trace from supplied evidence; say UNVERIFIED when behavior cannot be established."};
  if(operation==="repair-artifact")return serverAiRepairContract(payload);
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
  choices?:Array<{finish_reason?:string|null;message?:{content?:string|Array<{type?:string;text?:string}>;reasoning_content?:string}}>;
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
  const choice=json.choices?.[0];
  if(choice?.finish_reason==="length"){
    throw Object.assign(new Error("模型回复达到输出长度上限，结果被截断。请缩小任务范围或切换模型后重试。"),{code:"AI_OUTPUT_INCOMPLETE"});
  }
  if(choice?.finish_reason==="content_filter"){
    throw new Error("模型服务拦截了回复，未返回完整 JSON 结果。");
  }
  const value=choice?.message?.content;
  if(typeof value==="string"&&value.trim())return value;
  if(Array.isArray(value)){
    const joined=value.filter((item)=>!item.type||item.type==="text"||item.type==="output_text")
      .map((item)=>item.text??"").join("").trim();
    if(joined)return joined;
  }
  if(choice?.message?.reasoning_content?.trim()){
    throw Object.assign(new Error("模型只返回了推理内容，没有最终 JSON 结果。请重试或切换模型。"),{code:"AI_OUTPUT_MISSING_FINAL"});
  }
  throw new Error("模型未返回最终 JSON 结果，请检查模型与接口协议。");
}

function parseStructuredResult<T>(text:string,contract:Contract<T>):T{
  const result=contract.parser.safeParse(parseStructuredAiOutput(text));
  if(result.success)return result.data;
  const fields=[...new Set(result.error.issues.map((issue)=>issue.path.join(".")||"结果"))].slice(0,4);
  const validationIssues=result.error.issues.slice(0,4).map(issue=>`${issue.path.join(".")||"结果"}: ${issue.message.slice(0,240)}`);
  throw Object.assign(new Error(`模型返回的 JSON 不符合任务结构（${fields.join("、")}）。请检查模型的结构化输出能力或切换模型。`),{code:"AI_OUTPUT_SCHEMA_MISMATCH",fields,validationIssues});
}

async function callVercelGateway<T>(args:{
  operation:AiOperation;
  config:Extract<ServerAiConfig,{mode:"vercel-gateway"}>;
  contract:Contract<T>;
  payload:unknown;
  images:ParsedImage[];
}){
  const {Output,generateText,gateway}=await loadVercelAiSdk();
  const generated=await measureServerAiSdkUsage(args.config,args.operation,()=>generateText({
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
    abortSignal:serverControlExecutionSignal(),
    timeout:args.config.timeoutMs,
  }));
  return args.contract.parser.parse(generated.output);
}

function directSystem<T>(config:Extract<ServerAiConfig,{mode:"openai-compatible"}>,contract:Contract<T>,repairFields?:string[]){
  const repair=repairFields ? "\nPREVIOUS OUTPUT INVALID: "+(repairFields.join(", ")||"required fields")+". Generate a COMPLETE syntactically valid JSON object, concise strings, no Markdown or commentary, and include ALL required fields with correct types. Recompute from the same evidence; never invent source facts or verification." : "";
  const base=SYSTEM+"\n\nTask: "+contract.instruction+repair;
  return config.responseFormat&&config.responseFormat!=="json-schema"
    ?base+"\nReturn JSON matching this exact schema:\n"+JSON.stringify(contract.schema.schema)
    :base;
}

function directFormat<T>(config:Extract<ServerAiConfig,{mode:"openai-compatible"}>,contract:Contract<T>){
  if(config.responseFormat==="prompt-json")return undefined;
  if(config.responseFormat==="json-object")return {type:"json_object" as const};
  return {type:"json_schema" as const,name:contract.schema.name,strict:true,schema:contract.schema.schema};
}

async function callResponses<T>(args:{operation:AiOperation;config:Extract<ServerAiConfig,{mode:"openai-compatible"}>;contract:Contract<T>;payload:unknown;images:ParsedImage[];repairFields?:string[]}){
  const request=await fetchServerAiProviderUsage(args.config,"responses",args.operation,args.config.baseUrl+"/responses",{
    method:"POST",
    redirect:"error",
    signal:AbortSignal.timeout(args.config.timeoutMs),
    headers:{Authorization:"Bearer "+args.config.apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:args.config.model,
      store:false,
      input:[
        {role:"system",content:[{type:"input_text",text:directSystem(args.config,args.contract,args.repairFields)}]},
        {role:"user",content:[
          {type:"input_text",text:JSON.stringify(args.payload)},
          ...args.images.map((image)=>({type:"input_image",image_url:image.dataUrl})),
        ]},
      ],
      max_output_tokens:10000,
      ...(args.config.reasoningEffort?{reasoning:{effort:args.config.reasoningEffort}}:{}),
      ...(directFormat(args.config,args.contract)?{text:{format:directFormat(args.config,args.contract)}}:{}),
    }),
  });
  const response=request.response;
  const json=await request.readJson() as ResponsesJson;
  if(!response.ok){
    const error=Object.assign(new Error(json.error?.message||("Server AI Responses HTTP "+response.status)),{httpStatus:response.status});
    throw error;
  }
  if(json.status&&json.status!=="completed")throw new Error("Server AI response status: "+json.status);
  return parseStructuredResult(responseText(json),args.contract);
}

async function callChat<T>(args:{operation:AiOperation;config:Extract<ServerAiConfig,{mode:"openai-compatible"}>;contract:Contract<T>;payload:unknown;images:ParsedImage[];repairFields?:string[]}){
  // An independent multi-case Judge requires more room than providers default to.
  // Only request the larger budget for the evidence-scoring contract. This
  // remains a strict JSON + Zod check; longer output never implies acceptance.
  const isEvaluation=args.contract.schema.name==="evolve_evaluation";
  const request=await fetchServerAiProviderUsage(args.config,"chat-completions",args.operation,args.config.baseUrl+"/chat/completions",{
    method:"POST",
    redirect:"error",
    signal:AbortSignal.timeout(args.config.timeoutMs),
    headers:{Authorization:"Bearer "+args.config.apiKey,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:args.config.model,
      ...(isEvaluation?{max_tokens:8192}:{}),
      ...(args.config.reasoningEffort?{reasoning_effort:args.config.reasoningEffort}:{}),
      messages:[
        {role:"system",content:directSystem(args.config,args.contract,args.repairFields)},
        {role:"user",content:args.images.length?[
          {type:"text",text:JSON.stringify(args.payload)},
          ...args.images.map((image)=>({type:"image_url",image_url:{url:image.dataUrl}})),
        ]:JSON.stringify(args.payload)},
      ],
      ...(args.config.responseFormat==="prompt-json"?{}:{
        response_format:args.config.responseFormat==="json-object"
          ?{type:"json_object"}
          :{type:"json_schema",json_schema:{name:args.contract.schema.name,strict:true,schema:args.contract.schema.schema}},
      }),
    }),
  });
  const response=request.response;
  const json=await request.readJson() as ChatJson;
  if(!response.ok)throw Object.assign(new Error(json.error?.message||("Server AI Chat HTTP "+response.status)),{httpStatus:response.status});
  return parseStructuredResult(chatText(json),args.contract);
}

async function structured<T>(operation:AiOperation,payload:unknown,schema:Contract<T>,media?:ServerAiMedia):Promise<T>{
  const config=await resolveServerAiConfig();
  if(!config){
    throw Object.assign(
      new Error("Server AI 未配置：请在设置中保存后端模型，或配置模型服务的 API Key、Base URL 和 Model。"),
      {code:"SERVER_AI_UNAVAILABLE"},
    );
  }
  const images=parseServerAiImages(media);
  if(config.mode==="vercel-gateway"){
    return callVercelGateway({operation,config,contract:schema,payload,images});
  }
  const invoke=async(repairFields?:string[])=>{
    const args={operation,config,contract:schema,payload,images,repairFields};
    if(config.protocol==="chat-completions")return callChat(args);
    if(config.protocol==="responses")return callResponses(args);
    try{return await callResponses(args);}
    catch(error){
      const status=(error as {httpStatus?:number}).httpStatus;
      if(status!==404&&status!==405&&status!==400)throw error;
      return callChat(args);
    }
  };
  try{
    try{return await invoke();}
    catch(error){
      // Generation is side-effect-free. Retry once for malformed/partial AI output only.
      // Provider auth, billing, network and arbitrary execution failures do not get retried.
      // Neither attempt bypasses JSON parsing or the versioned Zod task contract.
      const code=(error as {code?:string}).code;
      if(!["AI_OUTPUT_SCHEMA_MISMATCH","AI_OUTPUT_INVALID_JSON","AI_OUTPUT_INCOMPLETE","AI_OUTPUT_MISSING_FINAL"].includes(code??""))throw error;
      const invalid=error as {fields?:string[];validationIssues?:string[]};
      const failedFields=invalid.validationIssues?.length?invalid.validationIssues:invalid.fields;
      return await invoke(failedFields?.length?failedFields:[code==="AI_OUTPUT_INVALID_JSON"?"JSON syntax or truncated JSON response":code??"invalid AI output"]);
    }
  }catch(error){
    if(error instanceof ServerControlExecutionStoppedError)throw error;
    const original=error as {message?:string;httpStatus?:number;code?:string};
    const transportFailure=aiProviderTransportFailure(error);
    const message=(transportFailure?serverAiUnavailableMessage(transportFailure):(original.message??String(error))).replaceAll(config.apiKey,"[REDACTED]");
    const code=transportFailure==="provider-timeout"?"SERVER_AI_PROVIDER_TIMEOUT"
      :transportFailure==="provider-network-error"?"SERVER_AI_PROVIDER_NETWORK_ERROR":original.code;
    throw Object.assign(new Error(message),{httpStatus:original.httpStatus,code});
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
  if(operation==="distill")payload=LessonDistillationContextSchema.parse(payload);
  return structured(operation,payload,contract(operation,payload),media);
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
  return aiProviderTransportFailure(error);
}

export function serverAiUnavailableMessage(reasonCode:string){
  if(reasonCode==="provider-network-error")return "后端暂时无法连接模型服务，已保留当前任务。请重试，或检查网络、接口地址和代理设置。";
  if(reasonCode==="provider-timeout")return "模型服务未在等待时间内返回完整结果，已保留当前任务。请缩小任务范围或切换模型后重试。";
  if(reasonCode==="customer-verification-required")return "Vercel AI Gateway 已配置，但团队尚未完成信用卡/账户验证；请改用真实 BYOK，或之后完成 Vercel AI Gateway 计费验证。";
  if(reasonCode==="provider-auth-or-billing")return "Server AI Provider 鉴权或计费不可用；请检查服务端 Provider 配置，或改用真实 BYOK。";
  if(reasonCode==="provider-rate-limit")return "Server AI Provider 当前额度/频率受限；请稍后重试或改用真实 BYOK。";
  if(reasonCode==="provider-unavailable")return "Server AI Provider 当前不可用；请稍后重试或改用真实 BYOK。";
  return "Server AI 未配置或当前不可用；请配置真实 Server AI / BYOK 后重试。";
}

export function isServerAiUnavailable(error:unknown){
  return Boolean(serverAiUnavailableReason(error));
}
