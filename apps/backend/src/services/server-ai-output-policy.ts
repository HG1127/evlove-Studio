import {AsyncLocalStorage} from "node:async_hooks";
import {z} from "zod";
import {PAIRED_OUTCOME_REFERENCE_POLICY,PAIRED_SOURCE_QUOTATION_POLICY,PAIRED_SOURCE_QUOTATION_TEMPLATE_POLICY,type AiOperation} from "@evolution/contracts";

const policySchema=z.object({formatCorrection:z.enum(["allow-once","forbid"]),pairedTransport:z.literal("jsonl-v1").optional()}).strict();
const scope=new AsyncLocalStorage<z.infer<typeof policySchema>>();
const transportSchema=z.enum(["json","jsonl-v1"]);
export const SERVER_PAIRED_OUTCOME_REFERENCE_VERSION="paired-outcome-reference-v3-all-criterion-evidence-status";
export const SERVER_PAIRED_SAFETY_POLICY_VERSION="paired-safety-v1-evidence-grounded-three-state";
export const SERVER_PAIRED_SOURCE_QUOTATION_VERSION="paired-source-quotation-v1-complete-range-notes";
export function serverAiPairedQuotationTemplatePolicy(){
 const raw=process.env.EVOLUTION_AI_PAIRED_QUOTATION_TEMPLATE?.trim();
 if(!raw)return undefined;
 if(raw!==PAIRED_SOURCE_QUOTATION_TEMPLATE_POLICY)throw Error("Invalid quotation template policy");
 if(!serverAiPairedSourceQuotationPolicy())throw Error("Quotation templates require explicit source quotation policy");
 return PAIRED_SOURCE_QUOTATION_TEMPLATE_POLICY;
}

/** A separate prospective protocol; no archived prose is reinterpreted as a structured claim. */
export function serverAiPairedSourceQuotationPolicy(){
  const raw=process.env.EVOLUTION_AI_PAIRED_SOURCE_QUOTATIONS?.trim();
  if(!raw)return undefined;
  if(raw!==PAIRED_SOURCE_QUOTATION_POLICY)throw Error("Invalid paired source quotation policy");
  if(!serverAiPairedSafetyPolicy()||!serverAiPairedJsonlEnabled())throw Error("Source quotations require explicit paired Safety, criterion evidence and JSONL policies");
  return PAIRED_SOURCE_QUOTATION_POLICY;
}

/** Prospective clarification only. Legacy verdicts and unknown-state gates are never rewritten. */
export function serverAiPairedSafetyPolicy(){
  const raw=process.env.EVOLUTION_AI_PAIRED_SAFETY_POLICY?.trim();
  if(!raw)return undefined;
  const parsed=z.literal("evidence-grounded-v1").safeParse(raw);
  if(!parsed.success)throw Error("Invalid paired Safety policy configuration");
  if(!serverAiPairedOutcomeReferenceMode())throw Error("Paired Safety policy requires explicit criterion evidence qualification");
  return parsed.data;
}

/** Prospective server policy shared by ordinary paired Missions and calibration. No scoped override. */
export function serverAiPairedOutcomeReferenceMode(){
  const raw=process.env.EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE?.trim();
  if(!raw)return undefined;
  const parsed=z.literal(PAIRED_OUTCOME_REFERENCE_POLICY).safeParse(raw);
  if(!parsed.success)throw Error("Invalid paired outcome reference configuration");
  return parsed.data;
}

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
