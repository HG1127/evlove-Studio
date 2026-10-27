import {ExactEditAnchorError,HtmlOriginalCodeRetentionError,HtmlSemanticLayoutError} from "@evolution/core";
import type {BuildCandidateAiResult} from "@evolution/contracts";

/** One pre-write construction correction; actual evaluation failures must retain their own repair budget. */
export function serverCandidateConstructionCorrection(error:unknown,invalidProposal:BuildCandidateAiResult["artifacts"]){
  if(error instanceof HtmlOriginalCodeRetentionError)return {code:error.code,retention:error.retention,invalidProposal,
    instruction:"The compiled proposal fails the SAME Original PRE/CODE retention policy required by native validation. No file was written. Preserve existing Original block text exactly, including whitespace and command examples. Put additional explanations in ordinary paragraphs OUTSIDE existing pre/code blocks. Do not remove or rewrite original commands, move copy targets or change scripts/styles. Use the identical currentTargets and issued physical anchors. This shares the existing single pre-write construction correction; it is not Visible/Hidden/final feedback, a new Candidate or an extra repair allowance."};
  if(error instanceof ExactEditAnchorError)return {code:error.code,editIndex:error.editIndex,invalidProposal,
    instruction:"The indicated before anchor was absent or non-unique in the full current parent. No file was written. Return a complete corrected proposal using ONLY unique verbatim before anchors from the SAME currentTargets source chunks or complete body anchor index already supplied. Do not invent source text or offsets. Preserve every original requirement and all untouched bytes. This is a construction error, not test or final-paper feedback."};
  if(error instanceof HtmlSemanticLayoutError)return {code:error.code,issues:error.issues.slice(0,20),omittedIssueCount:Math.max(0,error.issues.length-20),invalidProposal,
    instruction:"The proposal breaks an Original component's known two-paragraph rendering contract. No file was written. Preserve its label and exactly two descendant paragraphs; its runtime removes the entire content-block and uses only those slots. Put extra explanatory prose outside that content-block in the same slide-body, retaining all model-authored information and protected source content. Use the SAME currentTargets and exact anchors; do not change scripts/styles, questions, thresholds or scope. This is a construction correction before any browser evaluation, not a repair of a failed test."};
  return undefined;
}
