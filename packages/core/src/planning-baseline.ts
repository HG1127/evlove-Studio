import type {EvolveProject} from "@evolution/contracts";
import {indexScopedAcceptanceResults} from "./acceptance-result-identity";

export const PLANNING_BASELINE_VERSION="planning-baseline-evidence-v1";
export function planningDeferredCriterionIds(project:EvolveProject){
  return new Set(["SYS-PAIRWISE",...(project.baselineRun?.referenceOnlyCriterionIds??[])]);
}
export function planningBaselineFailures(project:EvolveProject){
  const deferred=planningDeferredCriterionIds(project);
  return (project.baselineRun?.result?.failures??[]).filter(line=>![...deferred].some(id=>line.includes(id)));
}
/** Current assessment rows, not historical advice and not an automatic passing verdict. */
export function planningBaselineEvidence(project:EvolveProject){
  const baseline=project.baselineRun,deferred=planningDeferredCriterionIds(project),result=baseline?.result;
  const indexed=indexScopedAcceptanceResults([{requestedCriterionIds:project.acceptanceRubric.map(c=>c.id),results:result?.criterionScores??[]}]);
  const visible=new Set((project.evalSuite??[]).map(test=>test.id));
  return {schemaVersion:PLANNING_BASELINE_VERSION,baselineId:baseline?.id,baselineStatus:baseline?.status??"missing",
    measurementFingerprint:baseline?.measurementFingerprint,scoringInputFingerprint:project.campaign?.scoringInputFingerprint,
    comparisonOnlyCriterionIds:project.acceptanceRubric.filter(c=>deferred.has(c.id)).map(c=>c.id),
    criteria:project.acceptanceRubric.filter(c=>!deferred.has(c.id)).map(criterion=>{
      const row=indexed.byId.get(criterion.id),ambiguous=indexed.duplicateIds.has(criterion.id);
      const verified=!ambiguous&&!result?.demoJudged&&row?.verificationStatus==="verified";
      return {criterionId:criterion.id,title:criterion.title,requirement:criterion.requirement,minScore:criterion.minScore,
        protectedConstraint:criterion.protectedConstraint,source:criterion.source,
        status:ambiguous?"ambiguous":result?.demoJudged?"demo":row?.verificationStatus??"missing",
        score:verified?row!.score:undefined,meetsMinimum:verified?row!.pass&&row!.score>=criterion.minScore:undefined,
        evidence:verified?[...(row!.evidence??[])]:[],gaps:verified?[...(row!.gaps??[])]:[],
        testCaseIds:[...(row?.testCaseIds??[])].filter(id=>visible.has(id)),
        improvementOpportunity:Boolean(verified&&criterion.source==="user-command"&&!criterion.protectedConstraint&&row!.gaps?.length),
      };
    }),
    failures:planningBaselineFailures(project),
    limitations:["Current Baseline assessment only. Passing an existing minimum does not establish the requested improvement.",
      "Deferred Original-only comparison is not a current product defect. All original comparison/protection gates remain required for a Candidate."],
  };
}

export const PLANNING_EVIDENCE_INSTRUCTION="Retain the full original goal, every supplied criterion, threshold, configured metric, explicit human clarification and protected item. The selected problem or a local diagnosis does not narrow that contract. Use the current planningBaseline assessment, its measured gaps and complete document context to decide which existing chapters/configurations need actual improvement. A high score or an already passed minimum does not prove the requested upgrade; later comparison must measure it. Input-understanding summaries are interpretations; they cannot invent or replace binding acceptance requirements. Historical advice and model narratives are proposals whose factual premises need current evidence. Located evidenceRefs verify a location, not semantic entailment and not a new acceptance requirement. Never infer that only a few opening pages are in scope from a local hypothesis. Explain concrete changes, their evidence and their contribution to the whole goal; preserve sections that already satisfy it. Keep all remaining gates and the independent final unchanged. Do not turn provider JSON/transport errors or deferred Original-only comparisons into invented document requirements.";
