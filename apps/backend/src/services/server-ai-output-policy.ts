import {AsyncLocalStorage} from "node:async_hooks";
import {z} from "zod";
import type {AiOperation} from "@evolution/contracts";

const policySchema=z.object({formatCorrection:z.enum(["allow-once","forbid"]),pairedTransport:z.literal("jsonl-v1").optional()}).strict();
const scope=new AsyncLocalStorage<z.infer<typeof policySchema>>();
const transportSchema=z.enum(["json","jsonl-v1"]);

/** A bounded caller may prohibit an additional semantic request without global env changes. */
export function withServerAiOutputPolicy<T>(raw:unknown,work:()=>T):T{
  const policy=policySchema.parse(raw);
  // A nested caller cannot expand the enclosing request's budget.
  const parent=scope.getStore();
  return scope.run({...policy,...(parent?.pairedTransport?{pairedTransport:parent.pairedTransport}:{}),
    ...(parent?.formatCorrection==="forbid"?{formatCorrection:"forbid" as const}:{})},work);
}
export function serverAiFormatCorrectionAllowed(){return scope.getStore()?.formatCorrection!=="forbid";}
/** Server configuration applies only to paired judging; a bounded explicit scope stays paired-only. */
export function serverAiPairedJsonlEnabled(operation:AiOperation="evaluate-paired"){
  const explicit=scope.getStore()?.pairedTransport==="jsonl-v1";
  if(operation!=="evaluate-paired"){
    if(explicit)throw Error("Paired JSONL scope permits evaluate-paired only");
    return false;
  }
  const configured=transportSchema.safeParse(process.env.EVOLUTION_AI_PAIRED_TRANSPORT?.trim()||"json");
  if(!configured.success)throw Error("Invalid paired AI transport configuration");
  return explicit||configured.data==="jsonl-v1";
}
