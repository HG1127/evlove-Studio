import {z} from "zod";
import {TextArtifactEditsSchema} from "@evolution/contracts";

export const DIRECT_AI_TEXT_EDIT_GUIDANCE_VERSION="text-edits-guidance-v1";
const Context=z.object({project:z.object({currentTargets:z.array(z.object({id:z.string(),mutationMode:z.string()}).passthrough())}).passthrough()}).passthrough();
const Recovery=z.object({attempt:z.literal(1),failure:z.object({version:z.literal("candidate-construction-failure-v1"),code:z.literal("text-edits")}).passthrough(),previousOutput:z.array(z.object({sourceArtifactId:z.string(),content:z.string()}).passthrough())}).passthrough();
const editSchema=z.toJSONSchema(TextArtifactEditsSchema);
const schemaKeys=new Set(["kind","edits","before","after","start","end"]);
function issuePath(index:number,parts:readonly PropertyKey[]){
 return `artifacts[${index}].content`+parts.map(part=>typeof part==="number"&&Number.isSafeInteger(part)&&part>=0?`[${part}]`:`.${typeof part==="string"&&schemaKeys.has(part)?part:"*"}`).join("");
}
/** Add request guidance only. The existing construction validator and single repair own acceptance. */
export function prepareDirectAiTextEditPayload(payload:unknown):unknown{
 const context=Context.safeParse(payload);
 if(!context.success)return payload;
 const targets=context.data.project.currentTargets.filter(target=>target.mutationMode==="text-edits");
 if(!targets.length)return payload;
 const targetIds=new Set(targets.map(target=>target.id)),original=payload as Record<string,unknown>;
 const recovery=Recovery.safeParse(original.recovery);
 const recoveryFeedback:Array<{artifactIndex:number;issues:Array<{path:string;code:string}>;omittedIssues?:number}>=[];
 if(recovery.success)recovery.data.previousOutput.forEach((artifact,index)=>{
  if(!targetIds.has(artifact.sourceArtifactId))return;
  let parsed:unknown;
  try{parsed=JSON.parse(artifact.content)}catch{recoveryFeedback.push({artifactIndex:index,issues:[{path:issuePath(index,[]),code:"invalid_json"}]});return}
  const checked=TextArtifactEditsSchema.safeParse(parsed);
  if(checked.success)return;
  const issues=checked.error.issues.slice(0,16).map(issue=>({path:issuePath(index,issue.path),code:issue.code}));
  recoveryFeedback.push({artifactIndex:index,issues,...(checked.error.issues.length>issues.length?{omittedIssues:checked.error.issues.length-issues.length}:{})});
 });
 return {...original,textEditsOutputContract:{
  version:DIRECT_AI_TEXT_EDIT_GUIDANCE_VERSION,encoding:"JSON string in artifacts[].content",schema:structuredClone(editSchema),
  instruction:"For each currentTargets item whose mutationMode is text-edits, artifacts[].content must be a JSON-encoded string matching this strict schema. Root keys are exactly kind and edits; each edit requires string before and after, with optional integer start/end only. Do not add summary, rationale, notes or other keys inside this string. Return all edits needed for the entire supplied Candidate plan within its existing protected/editable scope. Copy before verbatim from supplied context or verifiedAnchors; it must resolve uniquely in the complete parent. Offsets are optional: omit them rather than estimate. The server preserves all untouched bytes; do not echo or regenerate the unmodified document. These are construction instructions, not evidence that any edit, protection or test passed.",
  recoveryFeedback,
 }};
}
