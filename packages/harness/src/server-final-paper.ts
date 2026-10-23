import type {EvolveProject,IndependentFinalExecutionContract,TestCase} from "@evolution/contracts";
import {assertIndependentFinalExecution,assertIndependentFinalPaper,finalHoldoutContractFingerprint,
  finalHoldoutExecutionFingerprint,finalHoldoutPaperHash,independentFinalReplacementBlocker} from "@evolution/core";

/** Reserve a new blind paper before the next planning call, retaining every superseded reservation. */
export async function prepareServerIndependentFinalPaper(project:EvolveProject,args:{round:number;at:string;artifacts:unknown[];
  executionContract?:IndependentFinalExecutionContract;reserve:(payload:unknown)=>Promise<TestCase[]>}){
  const previous=project.finalHoldout;
  const contractFingerprint=finalHoldoutContractFingerprint(project);
  const executionContractFingerprint=args.executionContract?finalHoldoutExecutionFingerprint(args.executionContract):undefined;
  if(previous?.round===args.round&&previous.contractFingerprint===contractFingerprint
    &&(!args.executionContract||previous.executionContractFingerprint===executionContractFingerprint)){
    if(args.executionContract)assertIndependentFinalExecution(previous.suite,args.executionContract);
    return {project,reserved:false};
  }
  const blocked=independentFinalReplacementBlocker(project,args.round);
  if(blocked)throw Error(blocked);
  const history=previous?[...(project.supersededFinalHoldouts??[]),{...previous,supersededAt:args.at,
    reason:previous.round===args.round?"执行契约更新；尚无本轮持久化候选或候选反馈，原题集及失败尝试保留。":"进入新的进化轮次；保留上一轮题集。"}]
    :project.supersededFinalHoldouts;
  const isolated={...project,supersededFinalHoldouts:history};
  const payload={
    project:{goal:project.goal,evolutionCommand:project.evolutionCommand,protectedItems:project.protectedItems,
      editableItems:project.editableItems,artifacts:args.artifacts},
    acceptanceRubric:project.acceptanceRubric,
    requiredHiddenCriterionIds:project.acceptanceRubric.map(criterion=>criterion.id),
    responseUse:"Only hiddenCases becomes the independent final paper. validationCases is unused here and cannot supply coverage. hiddenCases alone must cover EVERY supplied acceptanceRubric Criterion ID, including all Hard Gates.",
    executionContract:args.executionContract,
    instruction:"Reserve independent final tests BEFORE the next Candidate planning call. Use only Original sources and the fixed goal/rubric. Respect each criterion's explicit scope and executionContract. A written-document criterion tests what the document actually states, not invented human trials, remote deployments, physical configuration or fault injection. Keep all criteria and thresholds; never weaken a criterion because a capability is unavailable. Use novel discriminative scenarios, not paraphrases or clones. Candidate content, plans, diagnosis and repair feedback are absent. This paper is never sent to the mutator and its failures must not trigger targeted repair.",
  };
  const validate=(suite:TestCase[])=>{
    assertIndependentFinalPaper(isolated,suite);
    if(args.executionContract)assertIndependentFinalExecution(suite,args.executionContract);
    return suite;
  };
  let suite:TestCase[];
  try{suite=validate(await args.reserve(payload));}
  catch(error){
    const code=(error as {code?:string}).code;
    if(code!=="INDEPENDENT_FINAL_PAPER_INVALID"&&code!=="INDEPENDENT_FINAL_EXECUTION_UNAVAILABLE")throw error;
    // Only an unreserved paper's contract may be repaired. Provider failures,
    // Candidate results and executed final-test feedback never enter this path.
    suite=validate(await args.reserve({...payload,generationCorrection:(error as Error).message}));
  }
  return {reserved:true,project:{...isolated,finalHoldout:{round:args.round,suite,paperHash:finalHoldoutPaperHash(suite),
    contractFingerprint,executionContractFingerprint,createdAt:args.at},updatedAt:args.at}};
}
