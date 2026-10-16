import {z} from "zod";
import {ReviewedHoldoutRunInputSchema} from "@evolution/contracts";

import {reviewedObservationError,type ReviewedObservationCode} from "./reviewed-workflow-observation-error";

export const REVIEWED_WORKFLOW_ID="workflow//./workflows/evolution-reviewed-holdout//evolutionReviewedHoldoutWorkflow";
export const REVIEWED_EXECUTE_STEP_ID="step//./workflows/evolution-reviewed-holdout/steps//executeReviewedHoldoutStep";
const acceptId="step//./workflows/evolution-reviewed-holdout/steps//acceptReviewedHoldoutStep";
const Run=z.object({runId:z.string().min(1),workflowName:z.literal(REVIEWED_WORKFLOW_ID),status:z.literal("completed"),deploymentId:z.string().min(1)});
const Step=z.object({runId:z.string().min(1),stepId:z.string().min(1),stepName:z.string().min(1),status:z.enum(["pending","running","completed","failed","cancelled"]),attempt:z.number().int().nonnegative()});
// This imported step has no captured scope or bound receiver. Match the SDK runtime envelope exactly.
const Input=z.object({args:z.tuple([ReviewedHoldoutRunInputSchema]),closureVars:z.undefined().optional(),thisVal:z.undefined().optional()}).strict();
const Output=z.object({result:z.object({missionId:z.string(),controlJobId:z.string(),status:z.literal("waiting-human"),iterations:z.literal(1),reason:z.string().min(1)}).strict(),continuation:z.never().optional()}).strict();
export type ReviewedSdkEvidence={runId:string;deploymentId:string;stepId:string;input:z.infer<typeof Input>["args"][0];output:z.infer<typeof Output>};
const observed=new WeakMap<object,string>();
/** A serialized/public copy or a changed observation is not a private World receipt. */
export function assertReviewedSdkEvidence(value:ReviewedSdkEvidence):void{
  if(!value||!observed.has(value)||observed.get(value)!==JSON.stringify(value))throw new Error("缺少当前请求中实际读取且未改动的私有 SDK 证据。");
}
type Reader={run(id:string):Promise<unknown>;page(id:string,cursor?:string):Promise<unknown>;step(runId:string,stepId:string):Promise<unknown>};
async function reader():Promise<Reader>{
  const [{getWorld},{decodeReviewedWorkflowIo}]=await Promise.all([import("workflow/runtime"),import("./reviewed-workflow-observation-codec")]);
  const world=await getWorld();let observedRun:{runId:string;deploymentId:string}|undefined;
  return{run:async id=>{const run=await world.runs.get(id,{resolveData:"none"});observedRun={runId:run.runId,deploymentId:run.deploymentId};return run;},
    page:(id,cursor)=>world.steps.list({runId:id,pagination:{limit:100,cursor},resolveData:"none"}),
    step:async(runId,stepId)=>{
      const run=observedRun;if(!run||run.runId!==runId)throw new Error("旧 Run 身份未核实。");
      const step=await world.steps.get(runId,stepId,{resolveData:"all"});
      const metadata=Step.parse(step);
      if(metadata.runId!==runId||metadata.stepId!==stepId||metadata.stepName!==REVIEWED_EXECUTE_STEP_ID||metadata.status!=="completed"||metadata.attempt!==1)throw new Error("旧步骤身份已变化。");
      const io=await decodeReviewedWorkflowIo(step,async()=>{
        if(!world.getEncryptionKeyForRun)throw new Error("SDK 派生密钥读取能力不可用。");
        return world.getEncryptionKeyForRun(runId,{deploymentId:run.deploymentId});
      });
      return{...step,...io};
    }};
}
/** Private World I/O only. A public Event or Mission DTO cannot manufacture this observation. */
async function validatedEvidence(runId:string,read?:Reader):Promise<ReviewedSdkEvidence>{
  let stage:ReviewedObservationCode="SDK_WORLD";
  try{
  const io=read??await reader();stage="SDK_RUN";const run=Run.parse(await io.run(runId));
  if(run.runId!==runId)throw new Error("旧 Run 身份不一致。");
  stage="SDK_PAGES";
  const steps:z.infer<typeof Step>[]=[];let cursor:string|undefined;const seen=new Set<string>();
  for(let page=0;page<10;page++){
    const batch=z.object({data:z.array(Step).max(100),hasMore:z.boolean(),cursor:z.string().nullable()}).parse(await io.page(runId,cursor));
    for(const step of batch.data){if(step.runId!==runId||seen.has(step.stepId))throw new Error("旧步骤身份或分页重复。");seen.add(step.stepId);steps.push(step);}
    if(!batch.hasMore)break;
    if(!batch.cursor||batch.cursor===cursor||page===9)throw new Error("旧步骤分页无法完整核验。");cursor=batch.cursor;
  }
  stage="SDK_STEP";
  if(steps.some(s=>s.stepName===acceptId))throw new Error("旧 Run 已进入 Gate F，不能通过无评审恢复路径重跑。");
  const selected=steps.filter(s=>s.stepName===REVIEWED_EXECUTE_STEP_ID);
  if(selected.length!==1||selected[0]!.status!=="completed"||selected[0]!.attempt!==1)throw new Error("旧评审步骤没有唯一首次完成记录。");
  const raw=await io.step(runId,selected[0]!.stepId),step=Step.parse(raw);
  if(JSON.stringify(step)!==JSON.stringify(selected[0]))throw new Error("旧步骤在读取期间发生变化。");
  stage="SDK_INPUT";const input=Input.parse(z.object({input:z.unknown()}).parse(raw).input).args[0];
  stage="SDK_OUTPUT";const output=Output.parse(z.object({output:z.unknown()}).parse(raw).output);
  stage="SDK_BINDING";
  if(input.missionId!==output.result.missionId||input.controlJobId!==output.result.controlJobId)throw new Error("旧步骤输入与完成结果不一致。");
  return{runId,deploymentId:run.deploymentId,stepId:step.stepId,input,output};
  }catch(error){throw reviewedObservationError(error,stage);}
}

/** Provider/storage failures may contain private serialized data; never expose them through an API. */
export async function readReviewedSdkEvidence(runId:string,read?:Reader):Promise<ReviewedSdkEvidence>{
  try{const evidence=await validatedEvidence(runId,read);observed.set(evidence,JSON.stringify(evidence));return evidence;}catch(error){throw reviewedObservationError(error,"SDK_OBSERVATION");}
}
