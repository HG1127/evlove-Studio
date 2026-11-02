import {AsyncLocalStorage} from "node:async_hooks";
import {z} from "zod";

const policySchema=z.object({formatCorrection:z.enum(["allow-once","forbid"]),pairedTransport:z.literal("jsonl-v1").optional()}).strict();
const scope=new AsyncLocalStorage<z.infer<typeof policySchema>>();

/** A bounded caller may prohibit an additional semantic request without global env changes. */
export function withServerAiOutputPolicy<T>(raw:unknown,work:()=>T):T{
  const policy=policySchema.parse(raw);
  // A nested caller cannot expand the enclosing request's budget.
  const parent=scope.getStore();
  return scope.run({...policy,...(parent?.pairedTransport?{pairedTransport:parent.pairedTransport}:{}),
    ...(parent?.formatCorrection==="forbid"?{formatCorrection:"forbid" as const}:{})},work);
}
export function serverAiFormatCorrectionAllowed(){return scope.getStore()?.formatCorrection!=="forbid";}
export function serverAiPairedJsonlEnabled(){return scope.getStore()?.pairedTransport==="jsonl-v1";}
