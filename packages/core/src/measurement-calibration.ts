import type {JudgeCalibrationObservation,JudgeCalibrationPlan} from "@evolution/contracts";
import {fastHash} from "./stable-hash";
import {inconclusivePairedCriteria,zeroOutcomeReferenceCriterionIds} from "./paired-judge";
import {isOriginalPreservationComparisonCriterion} from "./baseline-original-reference";

/** V2/V3 registration, rather than metadata alone, activates the existing zero reference. */
export function registeredZeroReferenceCriterionIds(plan:JudgeCalibrationPlan){
 if(plan.schemaVersion==="judge-calibration-plan-v1")return [];
 return zeroOutcomeReferenceCriterionIds(plan.criteria).filter(id=>plan.controls.some(c=>c.kind==="known-regression"
  &&c.expectations.some(e=>e.criterionId===id&&e.direction==="no-improvement")));
}

/** Exclude only the two receipt references to avoid a circular content hash. Array order stays fixed. */
export function calibrationPlanApprovalText(plan:JudgeCalibrationPlan){
 const {preregistrationSha256,oracleApprovalSha256,...content}=plan;void preregistrationSha256;void oracleApprovalSha256;
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"
  ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;
 return JSON.stringify(canonical(content));
}

/** Fixed controls qualify a measurement method; they never rescore a Mission or relax its thresholds. */
export function assessMeasurementCalibration(plan:JudgeCalibrationPlan,observations:JudgeCalibrationObservation[]){
 const blockers:string[]=[];
 const fail=(reason:string)=>blockers.push(reason);
 const zeroReferenceIds=new Set(registeredZeroReferenceCriterionIds(plan));
 const preservationIds=new Set(plan.schemaVersion==="judge-calibration-plan-v4"?plan.preservationCriterionIds:[]);
 if(observations.length!==plan.controls.length||new Set(observations.map(o=>o.controlId)).size!==observations.length)
  fail("Calibration observations are incomplete or duplicated; no best-of selection");
 if(fastHash(plan.criteria)!==plan.rubricFingerprint||fastHash(plan.testCases)!==plan.suiteFingerprint)fail("Fixed rubric thresholds or paper differ from their fingerprints");
 for(const criterion of plan.criteria){
  if(!plan.controls.some(c=>c.kind==="identical"&&c.context.criterionIds.includes(criterion.id)))fail("Missing fixed identical control for "+criterion.id);
  const directions=plan.controls.flatMap(c=>c.expectations.filter(e=>e.criterionId===criterion.id).map(e=>e.direction));
  const eligiblePreservation=plan.schemaVersion==="judge-calibration-plan-v4"&&criterion.category==="artifact-specific"
   &&criterion.source==="source-understanding"&&criterion.validationMethod==="cross-artifact"
   &&isOriginalPreservationComparisonCriterion(criterion,plan.sourceArtifactCount);
  if(preservationIds.has(criterion.id)&&!eligiblePreservation)fail("Ineligible preservation comparison: "+criterion.id);
  const preservation=preservationIds.has(criterion.id)&&eligiblePreservation;
  const semanticImprovement=!preservation&&(criterion.judgeType==="llm"||criterion.judgeType==="pairwise")&&!criterion.protectedConstraint&&!["integrity","protected"].includes(criterion.category);
  if((!directions.includes("regress")&&!zeroReferenceIds.has(criterion.id))||(semanticImprovement&&!directions.includes("improve")))fail("Missing labelled improvement/regression contrast for "+criterion.id);
  if(plan.schemaVersion==="judge-calibration-plan-v3"||plan.schemaVersion==="judge-calibration-plan-v4"){
   const labels=plan.controls.flatMap(c=>c.expectations.filter(e=>e.criterionId===criterion.id).flatMap(e=>[e.originalPass,e.candidatePass]));
   if(!labels.includes(true)||!labels.includes(false))fail("Missing labelled pass/fail threshold contrasts for "+criterion.id);
  }
 }
 for(const control of plan.controls){
  const matches=observations.filter(o=>o.controlId===control.id),observation=matches[0];
  if(matches.length!==1||!observation){fail("Missing unique control "+control.id);continue;}
  const r=observation.receipt,{samples,limitations,scoringRouteFingerprint,outcomeReferencePolicy,evidenceStatusPolicy,sourceQuotationPolicy,...context}=r;void limitations;void outcomeReferencePolicy;void sourceQuotationPolicy;
  if(fastHash(context)!==fastHash(control.context)||scoringRouteFingerprint!==plan.scoringRouteFingerprint
   ||r.rubricFingerprint!==plan.rubricFingerprint||r.suiteFingerprint!==plan.suiteFingerprint){
   fail("Control identity/model/file/paper binding differs: "+control.id);continue;
  }
  if(Date.parse(observation.firstRequestAt)<Date.parse(plan.registeredAt)
    ||Date.parse(observation.completedAt)<Date.parse(observation.firstRequestAt)){
   fail("Control predates its fixed registration: "+control.id);continue;
  }
  const criteria=plan.criteria.filter(c=>r.criterionIds.includes(c.id));
  if(criteria.length!==r.criterionIds.length){fail("Unregistered criterion in "+control.id);continue;}
  if(control.expectations.length!==criteria.length||new Set(control.expectations.map(e=>e.criterionId)).size!==criteria.length
    ||control.expectations.some(e=>!criteria.some(c=>c.id===e.criterionId)))fail("Fixed expectation identities differ: "+control.id);
  if(control.expectations.some(e=>e.direction==="no-improvement"&&(!zeroReferenceIds.has(e.criterionId)||control.kind!=="known-regression")))
   fail("Invalid zero-reference non-improvement expectation: "+control.id);
  if(control.kind==="identical"&&control.expectations.some(e=>e.direction!=="same")
    ||control.kind==="known-improvement"&&(!control.expectations.some(e=>e.direction==="improve")||control.expectations.some(e=>e.direction==="regress"||e.direction==="no-improvement"))
    ||control.kind==="known-regression"&&(!control.expectations.some(e=>e.direction==="regress"||e.direction==="no-improvement"&&zeroReferenceIds.has(e.criterionId))||control.expectations.some(e=>e.direction==="improve")))fail("Control label contradicts its fixed expectations: "+control.id);
  for(const sample of samples)for(const arm of [sample.original,sample.candidate,sample.controlOriginal])for(const row of arm.criteria){
   const expected=plan.testCases.filter(t=>t.criterionIds.includes(row.criterionId)).map(t=>t.id);
   if(!expected.length||row.testCaseIds.length!==expected.length||new Set(row.testCaseIds).size!==row.testCaseIds.length||row.testCaseIds.some(id=>!expected.includes(id)))fail("Control case mapping differs: "+control.id);
  }
  for(const criterion of criteria)for(const arm of ["original","candidate"] as const){
   const anchors=control.anchors.filter(a=>a.criterionId===criterion.id&&a.arm===arm&&a.scope==="source-text");
   if(!anchors.length||anchors.some(a=>!r.bindings.some(b=>b.sourceArtifactId===a.sourceArtifactId
    &&a.sourceSha256===(arm==="original"?b.originalSha256:b.candidateSha256))))
    fail("Missing source-text anchor for "+control.id+"/"+criterion.id+"/"+arm);
  }
  if(inconclusivePairedCriteria(r,criteria).length)fail("Unqualified control threshold/direction/copy measurement: "+control.id);
  if((evidenceStatusPolicy||plan.schemaVersion==="judge-calibration-plan-v4")&&samples.some(s=>[s.original,s.candidate,s.controlOriginal].some(a=>a.safety==="REVIEW")))
   fail("Unknown control Safety cannot qualify an explicit evidence measurement: "+control.id);
  if(criteria.some(c=>zeroReferenceIds.has(c.id))&&samples.some(s=>[s.original,s.candidate,s.controlOriginal].some(a=>a.safety==="REVIEW")))
   fail("Unknown zero-reference evidence cannot qualify a control: "+control.id);
  const unchanged=r.bindings.every(b=>b.originalSha256===b.candidateSha256);
  if((control.kind==="identical")!==unchanged)fail("Control subject hashes differ from its fixed label: "+control.id);
  for(const sample of samples)for(const criterion of criteria){
   const a=sample.original.criteria.find(x=>x.criterionId===criterion.id)!;
   const b=sample.candidate.criteria.find(x=>x.criterionId===criterion.id)!;
   const delta=b.score-a.score,direction=control.expectations.find(e=>e.criterionId===criterion.id)?.direction;
   if(plan.schemaVersion==="judge-calibration-plan-v3"||plan.schemaVersion==="judge-calibration-plan-v4"){
    const oracle=control.expectations.find(e=>e.criterionId===criterion.id);
    if(!oracle||!("originalPass" in oracle)||!("candidatePass" in oracle))fail("Missing absolute threshold oracle: "+control.id+"/"+criterion.id);
    else for(const [arm,row,expected] of [["original",a,oracle.originalPass],["candidate",b,oracle.candidatePass]] as const){
     if(typeof expected!=="boolean"||(expected?(!row.pass||row.score<criterion.minScore):(row.pass||row.score>=criterion.minScore)))
      fail("Absolute threshold oracle contradicted: "+control.id+"/"+criterion.id+"/"+arm);
    }
   }
   if(zeroReferenceIds.has(criterion.id)&&(a.score!==0||a.pass))
    fail("Original self-comparison is not the registered zero reference: "+control.id+"/"+criterion.id);
   if(direction==="no-improvement"&&(b.score!==0||b.pass))
    fail("Known non-improvement is not an exact zero failure: "+control.id+"/"+criterion.id);
   if(direction==="same"&&(delta!==0||a.pass!==b.pass||control.kind==="identical"&&sample.original.safety!==sample.candidate.safety))
    fail("Nonzero identical control: "+control.id+"/"+criterion.id);
   if(direction==="improve"&&(delta<control.minAbsoluteDelta||!b.pass||b.score<criterion.minScore||sample.candidate.safety!=="PASS"))
    fail("Known improvement not measured consistently: "+control.id+"/"+criterion.id);
   if(direction==="regress"&&delta>-control.minAbsoluteDelta)
    fail("Known regression not detected: "+control.id+"/"+criterion.id);
  }
 }
 return {schemaVersion:plan.schemaVersion==="judge-calibration-plan-v4"?"measurement-calibration-decision-v4" as const:plan.schemaVersion==="judge-calibration-plan-v3"?"measurement-calibration-decision-v3" as const:plan.schemaVersion==="judge-calibration-plan-v2"?"measurement-calibration-decision-v2" as const:"measurement-calibration-decision-v1" as const,ready:blockers.length===0,blockers,
  criterionIds:plan.criteria.map(c=>c.id),controls:plan.controls.map(c=>c.id),
  limitations:["Fixed labelled controls qualify only this exact route, rubric, source and paper; they are not Mission acceptance or business evidence.",
   "No thresholds, old scores, Safety failures or independent-final questions are changed; native facts do not replace semantic anchors."]};
}
