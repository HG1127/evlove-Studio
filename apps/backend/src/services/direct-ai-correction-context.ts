import { z } from "zod";
import { readStructuredAiFinalText, type StructuredAiJsonFailureKind } from "@evolution/adapters";
export type DirectAiCorrectionFailureKind = StructuredAiJsonFailureKind | "schema-shape";
export const DIRECT_AI_REJECTED_FINAL_MAX_BYTES=2*1024*1024;
export const DIRECT_AI_CORRECTION_CONTEXT_MAX_BYTES=4*1024*1024;
export const DIRECT_AI_CORRECTION_REQUEST_MAX_BYTES=32*1024*1024;
const ContextSchema=z.object({schemaVersion:z.literal("untrusted-rejected-output-v1"),
  failureKind:z.enum(["non-json-envelope","trailing-content","unescaped-control","invalid-escape",
    "unfinished-string","unfinished-root","invalid-syntax","schema-shape"]),rejectedFinalText:z.string().min(1)}).strict();
function unavailable(code:string):never{
  throw Object.assign(new Error("完整模型纠正上下文无法安全提供；未重发请求。"),{code});
}
/** Privacy scan only. Decoded escapes are never used to repair or resend the output. */
function containsCredential(text:string,apiKey:string):boolean{
  if(!apiKey)return false;
  if(text.includes(apiKey))return true;
  // Scan JSON escape tokens even when the surrounding rejected JSON is malformed.
  const decoded=text.replace(/\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g,token=>JSON.parse('"'+token+'"') as string);
  return decoded.includes(apiKey);
}
/** Complete final output only, privately quarantined as data for the same provider's one correction. */
export function buildDirectAiCorrectionContext(args:{text:string;kind:DirectAiCorrectionFailureKind;apiKey:string}):string{
  const rejectedFinalText=readStructuredAiFinalText(args.text);
  if(Buffer.byteLength(rejectedFinalText,"utf8")>DIRECT_AI_REJECTED_FINAL_MAX_BYTES)unavailable("AI_OUTPUT_CORRECTION_CONTEXT_TOO_LARGE");
  if(containsCredential(rejectedFinalText,args.apiKey))unavailable("AI_OUTPUT_CORRECTION_SECRET_PRESENT");
  const context=JSON.stringify(ContextSchema.parse({schemaVersion:"untrusted-rejected-output-v1",failureKind:args.kind,rejectedFinalText}));
  if(Buffer.byteLength(context,"utf8")>DIRECT_AI_CORRECTION_CONTEXT_MAX_BYTES)unavailable("AI_OUTPUT_CORRECTION_CONTEXT_TOO_LARGE");
  return context;
}
/** Count the serialized native request, including original evidence/media and escaped private data. */
export function assertDirectAiCorrectionRequestBudget(body:string):void{
  if(Buffer.byteLength(body,"utf8")>DIRECT_AI_CORRECTION_REQUEST_MAX_BYTES)unavailable("AI_OUTPUT_CORRECTION_REQUEST_TOO_LARGE");
}
