import {ReviewedHoldoutRunInputSchema,type EvolutionWorkflowResult} from "@evolution/contracts";
import {initializeWorkflowControlStep,finalizeWorkflowResultStep} from "./evolution-mission/steps";
import {executeReviewedHoldoutStep,acceptReviewedHoldoutStep} from "./evolution-reviewed-holdout/steps";

export async function evolutionReviewedHoldoutWorkflow(raw:unknown):Promise<EvolutionWorkflowResult>{
  "use workflow";
  const input=ReviewedHoldoutRunInputSchema.parse(raw);
  await initializeWorkflowControlStep(input);
  try{
    const execution=await executeReviewedHoldoutStep(input);
    const result=execution.continuation?await acceptReviewedHoldoutStep(input,execution.continuation):execution.result;
    return finalizeWorkflowResultStep(input,result);
  }catch{
    return finalizeWorkflowResultStep(input,{missionId:input.missionId,controlJobId:input.controlJobId,status:"failed",iterations:1,
      reason:"人工复核隔离验证未完成；保留已写入的 REVIEW 和执行记录，请核对后台错误，不自动重试评审。"});
  }
}
