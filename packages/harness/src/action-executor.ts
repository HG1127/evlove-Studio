import {
  createEvolutionEvent,
  EvolutionJobSchema,
  PRODUCTION_SCHEMA_VERSIONS,
  type ProductionRuntimePorts,
} from "@evolution/contracts";

export type HarnessActionControl = "continue"|"stop";
export type HarnessActionResult = { control: HarnessActionControl; detail?: string };

export type HarnessExecutionPlan<Action extends string = string> = {
  decision: { action: Action; reason: string };
  checkpoint: { id: string; stage: string; round: number };
  policy: { mode: string };
};

export type HarnessActionHandler<Plan extends HarnessExecutionPlan = HarnessExecutionPlan> =
  (plan: Plan) => Promise<HarnessActionResult|void>|HarnessActionResult|void;

export type HarnessActionHandlers<Plan extends HarnessExecutionPlan = HarnessExecutionPlan> =
  Record<Plan["decision"]["action"], HarnessActionHandler<Plan>>;

export interface HarnessActionExecutor<Plan extends HarnessExecutionPlan = HarnessExecutionPlan> {
  execute(plan:Plan):Promise<HarnessActionResult>;
  actions():Array<Plan["decision"]["action"]>;
}

export function createHarnessActionExecutor<Plan extends HarnessExecutionPlan>(
  missionId:string,
  handlers:HarnessActionHandlers<Plan>,
  runtime:ProductionRuntimePorts,
):HarnessActionExecutor<Plan> {
  return {
    actions:()=>Object.keys(handlers) as Array<Plan["decision"]["action"]>,
    async execute(plan){
      const action=plan.decision.action as Plan["decision"]["action"];
      const jobId=`action:${missionId}:${plan.checkpoint.id}:${action}`;
      const existing=await runtime.jobs.get(jobId).catch(()=>undefined);
      const startedAt=new Date().toISOString();
      const job=EvolutionJobSchema.parse({
        schemaVersion:PRODUCTION_SCHEMA_VERSIONS.job,
        id:jobId,
        missionId,
        type:action==="run-campaign"?"campaign":action==="package"?"materialize":"mission-action",
        status:"running",
        label:`Harness · ${action}`,
        idempotencyKey:`${missionId}:${plan.checkpoint.id}:${action}`,
        generation:(existing?.generation??0)+1,
        attempts:(existing?.attempts??0)+1,
        priority:50,
        checkpointId:plan.checkpoint.id,
        inputRef:action,
        createdAt:existing?.createdAt??startedAt,
        startedAt,
        heartbeatAt:startedAt,
        updatedAt:startedAt,
      });
      await runtime.events.append(createEvolutionEvent({missionId,type:"ActionPlanned",source:"evolution-harness",checkpointId:plan.checkpoint.id,payload:{action,reason:plan.decision.reason,policy:plan.policy.mode}}));
      await runtime.events.append(createEvolutionEvent({missionId,type:"CheckpointCreated",source:"evolution-harness",checkpointId:plan.checkpoint.id,payload:{stage:plan.checkpoint.stage,round:plan.checkpoint.round}}));
      await runtime.jobs.put(job);
      await runtime.events.append(createEvolutionEvent({missionId,type:"JobStarted",source:"evolution-harness",jobId,checkpointId:plan.checkpoint.id,payload:{type:job.type,generation:job.generation}}));
      await runtime.events.append(createEvolutionEvent({missionId,type:"ActionStarted",source:"evolution-harness",jobId,checkpointId:plan.checkpoint.id,payload:{action,reason:plan.decision.reason}}));
      try{
        const handler=handlers[action];
        if(!handler) throw new Error(`Harness action handler 未注册：${String(action)}`);
        const result=await handler(plan);
        const normalized=result??{control:"continue" as const};
        const finishedAt=new Date().toISOString();
        await runtime.jobs.put(EvolutionJobSchema.parse({...job,status:"completed",finishedAt,updatedAt:finishedAt}));
        await runtime.events.append(createEvolutionEvent({missionId,type:"ActionCompleted",source:"evolution-harness",jobId,checkpointId:plan.checkpoint.id,payload:{action,control:normalized.control,detail:normalized.detail}}));
        await runtime.events.append(createEvolutionEvent({missionId,type:"JobCompleted",source:"evolution-harness",jobId,checkpointId:plan.checkpoint.id,payload:{action}}));
        return normalized;
      }catch(error){
        const finishedAt=new Date().toISOString();
        const message=error instanceof Error?error.message:String(error);
        await runtime.jobs.put(EvolutionJobSchema.parse({...job,status:"failed",error:message,finishedAt,updatedAt:finishedAt})).catch(()=>undefined);
        await runtime.events.append(createEvolutionEvent({missionId,type:"ActionFailed",source:"evolution-harness",jobId,checkpointId:plan.checkpoint.id,payload:{action,error:message}})).catch(()=>undefined);
        await runtime.events.append(createEvolutionEvent({missionId,type:"JobFailed",source:"evolution-harness",jobId,checkpointId:plan.checkpoint.id,payload:{action,error:message}})).catch(()=>undefined);
        throw error;
      }
    },
  };
}
