import {HtmlNativeBrowserStepSchema,type TestCase} from "@evolution/contracts";
import {sourceGroundedHtmlSearchSteps} from "./html-protection-browser-steps";

/** Recognize the exact current plan or the previously frozen nine-step plan; never replace either. */
export function isSourceGroundedHtmlSearchPlan(html:string,steps:NonNullable<TestCase["browserSteps"]>){
  const canonical=sourceGroundedHtmlSearchSteps(html);
  if(!canonical)return false;
  const legacy=canonical.filter((_,index)=>![3,4,9].includes(index));
  const key=htmlNativeBrowserPlanKey(steps);
  return key!==undefined&&(key===htmlNativeBrowserPlanKey(canonical)||key===htmlNativeBrowserPlanKey(legacy));
}

/** Exact predicate identity, including order; a short cache hash is insufficient for assertion binding. */
export function htmlNativeBrowserPlanKey(steps:TestCase["browserSteps"]){
  const parsed=HtmlNativeBrowserStepSchema.array().min(1).max(12).safeParse(steps);
  return parsed.success?JSON.stringify(parsed.data):undefined;
}
