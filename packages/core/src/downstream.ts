import type { EvolveProject } from "@evolution/contracts";

/** 进化输入变化后的统一失效处理。Workflow Step 可传 nowMs 保证重放时 ID 稳定。 */
export function resetDownstream(
  current: EvolveProject,
  options?: { invalidateUnderstanding?: boolean; nowMs?: number },
): EvolveProject {
  const nowMs=options?.nowMs??Date.now();
  return {
    ...current,
    ...(options?.invalidateUnderstanding ? {inputUnderstanding:undefined,inputClarifications:[],sourceUnderstanding:undefined} : {}),
    stage:"target" as const,
    acceptanceRubric:[],
    acceptanceRubricState:{status:"idle",summary:"输入变化，需要重新编译 Project-specific Acceptance Rubric",version:current.acceptanceRubricState.version+1,weightTotal:0,uncoveredCriterionIds:[],warnings:[]},
    artifactAcceptance:{id:`artifact-acceptance-${nowMs}`,status:"idle",overallScore:0,coverageScore:0,integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,maxRepairAttempts:current.artifactAcceptance.maxRepairAttempts??3,summary:"输入变化，旧成果验收已失效"},
    archivedOutputs:[...new Map([...(current.archivedOutputs??[]),...(current.outputArtifacts??[]).map(artifact=>({...artifact,isChampion:false,description:`历史目标成果（不用于当前目标验收）：${artifact.description}`}))].map(artifact=>[`${artifact.id}:${artifact.createdAt}`,artifact])).values()],
    outputArtifacts:[],
    searchChampion:undefined,
    searchAppliedPatches:[],
    evolutionArchive:[],
    campaign:{...current.campaign,status:"idle",currentRound:0,noImprovementRounds:0,bestScore:undefined,rootBaseline:undefined,checkpoint:undefined,startedAt:undefined,completedAt:undefined,stopReason:undefined,estimatedCost:0,schedule:{...current.campaign.schedule,enabled:false,nextRunAt:undefined}},
    evalSuite:[],hiddenEvalSuite:[],problems:[],selectedProblemId:undefined,diagnosis:undefined,
    candidates:[],selectedCandidateIds:[],
    baselineRun:{id:`baseline-${nowMs}`,status:"idle" as const,suiteName:"Core Validation Suite",totalCases:0,runs:[]},
    experimentRun:{id:`experiment-${nowMs}`,status:"idle" as const,candidateResults:[]},
    validationRun:{id:`validation-${nowMs}`,status:"idle" as const,checks:[],runs:[],baselineRuns:[]},
    release:{status:"idle" as const,trafficPercent:0,kpis:[],evidenceMode:"none" as const,history:[]},
    gates:current.gates.map((gate)=>gate.id==="target-ready"
      ? {...gate,status:"ready" as const,approvedAt:undefined,note:"进化输入或命令已更新，需要重新确认 Target Ready"}
      : {...gate,status:"pending" as const,approvedAt:undefined,note:undefined}),
  };
}

/** Changing the selected problem preserves intake and baseline, but invalidates descendants. */
export function resetForProblem(current:EvolveProject,problemId:string):EvolveProject{
  if(current.selectedProblemId===problemId)return current;
  const reset=resetDownstream(current);
  return {
    ...reset,
    stage:"problem",
    selectedProblemId:problemId,
    acceptanceRubric:current.acceptanceRubric,
    acceptanceRubricState:current.acceptanceRubricState,
    baselineRun:current.baselineRun,
    evalSuite:current.evalSuite,
    hiddenEvalSuite:current.hiddenEvalSuite,
    problems:current.problems.map(problem=>({...problem,status:problem.id===problemId?"selected":problem.status==="selected"?"observing":problem.status})),
    gates:reset.gates.map(gate=>gate.id==="target-ready"?current.gates.find(item=>item.id===gate.id)!:gate),
  };
}
