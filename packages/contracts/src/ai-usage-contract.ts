import {z} from "zod";
import {AiOperationSchema} from "./ai-schemas";

const id=z.string().min(1).max(200);
const tokens=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const model=z.string().min(1).max(200);
export const AiUsageProtocolSchema=z.enum(["responses","chat-completions","ai-sdk"]);
export type AiUsageProtocol=z.infer<typeof AiUsageProtocolSchema>;
export const AiUsageScopeSchema=z.object({
  missionId:id.optional(),jobId:id.optional(),phase:z.string().min(1).max(120),stepKey:id.optional(),candidateId:id.optional(),
}).strict().refine(scope=>Boolean(scope.missionId)===Boolean(scope.jobId),{message:"Mission and Job identities must be supplied together"});
export type AiUsageScope=z.infer<typeof AiUsageScopeSchema>;
export const AiProviderTokenCountsSchema=z.object({input:tokens.optional(),output:tokens.optional(),total:tokens.optional(),reasoning:tokens.optional(),cacheRead:tokens.optional()}).strict();
export const AiProviderTokenUsageSchema=z.object({
  status:z.enum(["complete","partial","unavailable","invalid"]),
  counts:AiProviderTokenCountsSchema,
  reason:z.enum(["missing-usage","invalid-fields","inconsistent-counts"]).optional(),
}).strict().superRefine((usage,context)=>{
  const counts=usage.counts,all=counts.input!==undefined&&counts.output!==undefined&&counts.total!==undefined;
  const any=Object.values(counts).some(value=>value!==undefined);
  const consistent=(counts.input===undefined||counts.output===undefined||counts.total===undefined||counts.input+counts.output===counts.total)
    &&(counts.reasoning===undefined||counts.output===undefined||counts.reasoning<=counts.output)
    &&(counts.cacheRead===undefined||counts.input===undefined||counts.cacheRead<=counts.input);
  if(usage.status==="complete"&&(!all||!consistent||usage.reason!==undefined)
    ||usage.status==="partial"&&(!any||all||!consistent)
    ||usage.status==="unavailable"&&any
    ||usage.status==="invalid"&&!usage.reason)context.addIssue({code:"custom",message:"Usage status must agree with observed counters"});
});
export type AiProviderTokenUsage=z.infer<typeof AiProviderTokenUsageSchema>;
export const AiUsageRouteSchema=z.object({
  operation:AiOperationSchema,protocol:AiUsageProtocolSchema,model,
  routeFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AiUsageRoute=z.infer<typeof AiUsageRouteSchema>;
export const AiUsageRequestStartedSchema=z.object({
  schemaVersion:z.literal("ai-usage-request-v1"),callId:z.uuid(),scope:AiUsageScopeSchema,route:AiUsageRouteSchema,
  granularity:z.enum(["physical-http-attempt","sdk-generation"]),attempt:z.number().int().positive(),startedAt:z.iso.datetime(),
}).strict();
export type AiUsageRequestStarted=z.infer<typeof AiUsageRequestStartedSchema>;
export const AiProviderCompletionSchema=z.object({
  finishReason:z.enum(["stop","length","content_filter","tool_calls","function_call","content-filter","tool-calls","error","other","unknown"]).optional(),
  responseStatus:z.enum(["completed","incomplete","failed","cancelled","in_progress","queued","other"]).optional(),
  incompleteReason:z.enum(["max_output_tokens","content_filter","other"]).optional(),
}).strict().refine(value=>Object.values(value).some(item=>item!==undefined),{message:"Completion metadata must contain an observed field"});
export type AiProviderCompletion=z.infer<typeof AiProviderCompletionSchema>;
export const AiProviderUsageObservationV1Schema=z.object({
  schemaVersion:z.literal("ai-provider-usage-v1"),request:AiUsageRequestStartedSchema,
  completedAt:z.iso.datetime(),elapsedMs:z.number().finite().nonnegative(),
  outcome:z.enum(["response","transport-error","sdk-error"]),httpStatus:z.number().int().min(100).max(599).optional(),
  responseId:z.string().regex(/^[a-zA-Z0-9._:-]{1,200}$/).optional(),responseModel:model.optional(),
  transportReason:z.enum(["provider-network-error","provider-timeout","unknown"]).optional(),
  usage:AiProviderTokenUsageSchema,
  billing:z.object({status:z.literal("unavailable")}).strict(),
}).strict();
export const AiProviderUsageObservationV2Schema=AiProviderUsageObservationV1Schema.extend({
  schemaVersion:z.literal("ai-provider-usage-v2"),completion:AiProviderCompletionSchema.nullable(),
});
/** Finite diagnostic facts only: never provider messages, URLs, headers, bodies or stacks. */
export const AiProviderTransportDiagnosticSchema=z.object({
  schemaVersion:z.literal("ai-provider-transport-diagnostic-v1"),
  phase:z.enum(["request","response-body","sdk-generation"]),
  origin:z.enum(["request-signal","execution-signal","native-connect","native-headers","native-body","transport-timeout","network","unknown"]),
  codes:z.array(z.enum(["ETIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT",
    "ECONNRESET","ECONNREFUSED","ENOTFOUND","EAI_AGAIN","EHOSTUNREACH","ENETUNREACH","UND_ERR_SOCKET",
    "SERVER_AI_PROVIDER_TIMEOUT","SERVER_AI_PROVIDER_NETWORK_ERROR","SERVER_CONTROL_EXECUTION_STOPPED"])).max(6),
  matchedSignal:z.enum(["request","execution","both"]).optional(),
  configuredTimeoutMs:z.number().int().positive().max(86_400_000).optional(),
}).strict().superRefine((value,ctx)=>{
  const required={"native-connect":"UND_ERR_CONNECT_TIMEOUT","native-headers":"UND_ERR_HEADERS_TIMEOUT","native-body":"UND_ERR_BODY_TIMEOUT"} as const;
  if(value.origin in required&&!value.codes.includes(required[value.origin as keyof typeof required]))ctx.addIssue({code:"custom",path:["origin"],message:"Native attribution needs its observed timeout code"});
  if(value.origin==="request-signal"&&value.matchedSignal!=="request"||value.origin==="execution-signal"&&value.matchedSignal!=="execution")
    ctx.addIssue({code:"custom",path:["matchedSignal"],message:"Signal attribution requires an exact matched reason"});
  const sources:string[]=Object.entries(required).filter(([,code])=>value.codes.includes(code)).map(([origin])=>origin);
  if(value.matchedSignal==="request"||value.matchedSignal==="both")sources.push("request-signal");
  if(value.matchedSignal==="execution"||value.matchedSignal==="both")sources.push("execution-signal");
  if(value.origin!=="unknown"&&(sources.length>1||sources.length===1&&sources[0]!==value.origin))
    ctx.addIssue({code:"custom",path:["origin"],message:"Competing or contradictory observed sources must remain unknown"});
});
export type AiProviderTransportDiagnostic=z.infer<typeof AiProviderTransportDiagnosticSchema>;
export const AiProviderUsageObservationV3Schema=AiProviderUsageObservationV2Schema.extend({
  schemaVersion:z.literal("ai-provider-usage-v3"),transportDiagnostic:AiProviderTransportDiagnosticSchema.optional(),
}).superRefine((value,ctx)=>{
  if(value.transportDiagnostic&&value.outcome==="response")ctx.addIssue({code:"custom",path:["transportDiagnostic"],message:"A response cannot claim a transport failure diagnostic"});
  if(value.transportDiagnostic&&value.outcome!=="response"&&((value.outcome==="sdk-error")!==(value.transportDiagnostic.phase==="sdk-generation")))
    ctx.addIssue({code:"custom",path:["transportDiagnostic","phase"],message:"Failure phase must match its transport kind"});
});
export const AiProviderUsageObservationSchema=z.discriminatedUnion("schemaVersion",[AiProviderUsageObservationV1Schema,AiProviderUsageObservationV2Schema,AiProviderUsageObservationV3Schema]);
export type AiProviderUsageObservation=z.infer<typeof AiProviderUsageObservationSchema>;
export const AiUsageLedgerRecordSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("request-start"),request:AiUsageRequestStartedSchema}).strict(),
  z.object({kind:z.literal("request-result"),observation:AiProviderUsageObservationSchema}).strict(),
]);
export type AiUsageLedgerRecord=z.infer<typeof AiUsageLedgerRecordSchema>;
export type AiUsageLedgerWriter=(record:AiUsageLedgerRecord)=>Promise<void>;
