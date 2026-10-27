import {AsyncLocalStorage} from "node:async_hooks";
import type {EvolutionJob,EvolutionWorkflowRunInput,ProductionRuntimePorts} from "@evolution/contracts";
import {buildWorkflowControlJobUpdate} from "@evolution/harness";

export class ServerControlExecutionStoppedError extends Error {
  readonly code="SERVER_CONTROL_EXECUTION_STOPPED";
  constructor(){
    super("控制 Job 已结束、被替换或无法核验；已停止后续请求和状态写入。");
    this.name="ServerControlExecutionStoppedError";
  }
}

type Binding={missionId:string;controlJobId:string;generation:number};
type Execution={binding:Binding;controller:AbortController;check:()=>Promise<void>};
const active=new AsyncLocalStorage<Execution>();
const executions=new Set<Execution>();

export function serverControlExecutionBinding(){return active.getStore()?.binding;}

export async function assertServerControlExecutionActive(missionId?:string){
  const execution=active.getStore();
  if(!execution)return;
  if(missionId&&missionId!==execution.binding.missionId)throw new ServerControlExecutionStoppedError();
  execution.controller.signal.throwIfAborted();
  await execution.check();
  execution.controller.signal.throwIfAborted();
}

export function serverControlExecutionSignal(signal?:AbortSignal|null){
  const execution=active.getStore();
  return execution?AbortSignal.any([execution.controller.signal,...(signal?[signal]:[])]):signal??undefined;
}

/** Fast local cancellation; durable polling also covers cancellation on another instance. */
export function abortServerControlExecutions(job:Pick<EvolutionJob,"id"|"missionId"|"generation">){
  for(const execution of executions){
    const binding=execution.binding;
    if(binding.controlJobId===job.id&&binding.missionId===job.missionId&&binding.generation===job.generation){
      execution.controller.abort(new ServerControlExecutionStoppedError());
    }
  }
}

export async function withServerControlExecution<T>(
  input:EvolutionWorkflowRunInput,
  readJob:(id:string)=>Promise<EvolutionJob|undefined>,
  work:()=>Promise<T>,
  pollMs=2_000,
):Promise<T>{
  const controller=new AbortController();
  const execution:Execution={binding:{missionId:input.missionId,controlJobId:input.controlJobId,generation:1},controller,
    check:async()=>{
      try{
        controller.signal.throwIfAborted();
        buildWorkflowControlJobUpdate(await readJob(input.controlJobId),input,{status:"running"},new Date().toISOString());
      }catch{
        controller.abort(new ServerControlExecutionStoppedError());
        throw controller.signal.reason;
      }
    }};
  return active.run(execution,async()=>{
    await assertServerControlExecutionActive();
    executions.add(execution);
    let checking=false;
    const timer=setInterval(()=>{
      if(checking||controller.signal.aborted)return;
      checking=true;
      void execution.check().catch(()=>undefined).finally(()=>{checking=false;});
    },pollMs);
    timer.unref();
    try{return await work();}
    finally{clearInterval(timer);executions.delete(execution);}
  });
}

/** Composition guard also protects injected/memory ports and persist callbacks. */
export function guardServerControlRuntime(runtime:ProductionRuntimePorts):ProductionRuntimePorts{
  return {...runtime,missions:{...runtime.missions,save:async project=>{
    await assertServerControlExecutionActive(project.id);
    return runtime.missions.save(project);
  }},events:{...runtime.events,append:async event=>{
    await assertServerControlExecutionActive(event.missionId);
    return runtime.events.append(event);
  }}};
}
