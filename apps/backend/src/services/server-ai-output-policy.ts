import {AsyncLocalStorage} from "node:async_hooks";
import {z} from "zod";

const policySchema=z.object({formatCorrection:z.enum(["allow-once","forbid"])}).strict();
const scope=new AsyncLocalStorage<z.infer<typeof policySchema>>();

/** A bounded caller may prohibit an additional semantic request without global env changes. */
export function withServerAiOutputPolicy<T>(raw:unknown,work:()=>T):T{
  const policy=policySchema.parse(raw);
  // A nested caller cannot expand the enclosing request's budget.
  return scope.run(scope.getStore()?.formatCorrection==="forbid"?{formatCorrection:"forbid"}:policy,work);
}
export function serverAiFormatCorrectionAllowed(){return scope.getStore()?.formatCorrection!=="forbid";}
