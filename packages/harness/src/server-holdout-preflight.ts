import type { Candidate, EvolveProject, TestCase, ValidationRun } from "@evolution/contracts";
import { evidenceFingerprint, rubricSuiteCoverage } from "@evolution/core";

/** Freeze the persisted Hidden paper after Winner selection; never synthesize or remap cases here. */
export function exactServerHoldoutSuite(project:EvolveProject){
  if(!project.hiddenEvalSuite.length)throw new Error("[server-campaign-holdout-contract-pending] Project hiddenEvalSuite is empty");
  const visibleIds=new Set(project.evalSuite.map((testCase)=>testCase.id));
  const overlaps=project.hiddenEvalSuite.filter((testCase)=>visibleIds.has(testCase.id));
  if(overlaps.length)throw new Error(`[server-campaign-holdout-contract-pending] Hidden Suite 与 Visible Suite 复用了 TestCase ID：${overlaps.map((item)=>item.id).join("、")}`);

  const hiddenIds=new Set<string>();
  const repeated=project.hiddenEvalSuite.filter((testCase)=>{
    if(hiddenIds.has(testCase.id))return true;
    hiddenIds.add(testCase.id);
    return false;
  });
  if(repeated.length)throw new Error(`[server-campaign-holdout-contract-pending] Hidden Suite 内部存在重复 TestCase ID：${repeated.map((item)=>item.id).join("、")}`);

  const known=new Set(project.acceptanceRubric.map((criterion)=>criterion.id));
  const invalid=project.hiddenEvalSuite.filter((testCase)=>!testCase.criterionIds.length||testCase.criterionIds.some((id)=>!known.has(id)));
  if(invalid.length)throw new Error(`[server-campaign-holdout-contract-pending] Hidden Suite 含未绑定/失效 Criterion 的题目：${invalid.map((item)=>item.id).join("、")}`);

  const coverage=rubricSuiteCoverage(project.acceptanceRubric,project.evalSuite,project.hiddenEvalSuite);
  if(!coverage.ready)throw new Error(`[server-campaign-holdout-contract-pending] Hidden Suite 未冻结覆盖当前 Rubric：${[
    ...coverage.uncovered,
    ...coverage.hiddenHardGateMissing.map((criterion)=>criterion.id),
  ].join("、")}`);
  return project.hiddenEvalSuite.map((testCase)=>({...testCase,hidden:true})) as TestCase[];
}

/** Persist a recoverable Holdout preflight failure while keeping the Experiment checkpoint intact. */
export function pauseServerHoldoutPreflight(
  project:EvolveProject,
  candidate:Candidate,
  round:number,
  reason:string,
  now:string,
){
  const validation:ValidationRun={
    id:`validation-server-r${round}`,
    status:"failed",
    validationMode:"full",
    plannedCases:project.hiddenEvalSuite.length,
    executedCases:0,
    candidateId:candidate.id,
    runs:[],
    baselineRuns:[],
    checks:[],
    evidenceFingerprint:evidenceFingerprint(project,candidate),
    error:reason,
    summary:reason,
  };
  const next:EvolveProject={
    ...project,
    validationRun:validation,
    stage:"validation",
    campaign:{
      ...project.campaign,
      status:"paused",
      stopReason:reason,
      checkpoint:project.campaign.checkpoint,
      schedule:{...project.campaign.schedule,enabled:false,nextRunAt:undefined},
    },
    updatedAt:now,
  };
  return {control:"stop" as const,project:next,validation,reason,readyForArtifactAcceptance:false,evidenceIncomplete:true};
}
