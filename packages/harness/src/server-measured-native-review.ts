import type {HtmlNativeObservation,TargetRunResult} from "@evolution/contracts";
import {inspectHtmlNativeEvidence} from "@evolution/core";

export type MeasuredNativeBinding={sourceArtifactId:string;subjectSha256:string;originalSha256?:string};
export function inspectMeasuredNativeRun(run:TargetRunResult,bindings?:readonly MeasuredNativeBinding[]){
  const inspected=inspectHtmlNativeEvidence(run,run.testCaseId);
  if(!inspected)return undefined;
  if(bindings){
    const expected=bindings.filter(item=>item.sourceArtifactId===inspected.proof.sourceArtifactId);
    if(expected.length!==1||expected[0]!.subjectSha256!==inspected.proof.subjectSha256
      ||expected[0]!.originalSha256!==undefined&&expected[0]!.originalSha256!==inspected.proof.observation.original.sha256)return undefined;
  }
  return inspected;
}

const safeId=(value:string)=>/^[A-Za-z0-9_:#.-]{1,160}$/.test(value)?value:"unclassified-profile-check";
function subjectFacts(subject:HtmlNativeObservation["subject"]){
  const inventory=subject.inventory;
  return {sha256:subject.sha256,bodyTextFingerprint:subject.bodyTextFingerprint,
    inventory:{cards:inventory.cards,pageCopy:inventory.pageCopy,promptCopy:inventory.promptCopy,editablePrompts:inventory.editablePrompts,
      checkItems:inventory.checkItems,checkPanels:inventory.checkPanels,details:inventory.details,internalLinks:inventory.internalLinks.length,unknownControls:inventory.unknownControls.length},
    checks:subject.checks.map(check=>({id:safeId(check.id),pass:check.pass,tested:check.tested,failed:check.failed,count:check.count,visible:check.visible,expected:check.expected})),
    failedCheckCount:subject.failures.length};
}
function facts(native:NonNullable<ReturnType<typeof inspectHtmlNativeEvidence>>){
  const proof=native.proof,o=proof.observation;
  return {scope:"known-renderer-physical-observations-only" as const,sourceArtifactId:proof.sourceArtifactId,profileId:o.profileId,
    isolation:o.isolation,observedAt:o.observedAt,kernelSha256:o.kernelSha256,programSignature:o.programSignature,styleSignature:o.styleSignature,
    originalHealthy:native.originalHealthy,profilePass:native.pass,failures:native.failures.map(safeId),
    declaredBrowserPlanStepCounts:o.browserAssertions?.plans.map(plan=>plan.length)??[],
    retention:o.codeBlockRetention,originalCodeBlocksRetained:o.originalCodeBlocksRetained,originalNamedElementsRetained:o.originalNamedElementsRetained,
    originalInteractiveSequenceRetained:o.originalInteractiveSequenceRetained,originalSlideCardOrderRetained:o.originalSlideCardOrderRetained,
    original:subjectFacts(o.original),subject:subjectFacts(o.subject),
    styleComparison:o.styleComparison.map(row=>({width:row.width,propertyCount:row.propertyCount,namedElementsCompared:row.namedElementsCompared,
      styleGroupsCompared:row.styleGroupsCompared,changedNamedCount:row.changedNamed.length,missingGroupCount:row.missingGroups.length,infiniteAnimations:row.infiniteAnimations,pass:row.pass}))};
}

/** Project only validated measured facts; never read source bytes, echo source code or assign Criterion scores. */
export function measuredNativeObservations(runs:TargetRunResult[],budget=24000,bindings?:readonly MeasuredNativeBinding[]){
  type Row={testCaseIds:string[];facts:ReturnType<typeof facts>};
  const groups=new Map<string,Row>(),omitted=new Set<string>(),counts=new Map<string,number>();
  for(const run of runs)counts.set(run.testCaseId,(counts.get(run.testCaseId)??0)+1);
  let remaining=budget;
  for(const run of runs){
    if(!run.nativeHtmlProof)continue;
    const inspected=run.verificationStatus==="verified"&&counts.get(run.testCaseId)===1?inspectMeasuredNativeRun(run,bindings):undefined;
    if(!inspected?.complete){omitted.add(run.testCaseId);continue;}
    const value=facts(inspected),key=JSON.stringify(value),prior=groups.get(key);
    const row:Row={testCaseIds:[...(prior?.testCaseIds??[]),run.testCaseId],facts:value};
    const extra=JSON.stringify(row).length-(prior?JSON.stringify(prior).length:0);
    if(extra>remaining){omitted.add(run.testCaseId);continue;}
    remaining-=extra;groups.set(key,row);
  }
  return {observations:[...groups.values()],omittedTestCaseIds:[...omitted]};
}
