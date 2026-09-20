import type {ProjectRuntime} from "../runtime/use-project-runtime";
import {deriveWorkflowSteps} from "../runtime/workflow-engine";
import {EVOLUTION_PHASES} from "../runtime/system-readiness";
export function WorkflowJourney({runtime}:{runtime:ProjectRuntime}){
 const steps=deriveWorkflowSteps(runtime.project);
 return <section aria-label="本轮执行链路" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{EVOLUTION_PHASES.map((stage,i)=>{
   const items=steps.filter(s=>Number(s.id)>=stage.range[0]&&Number(s.id)<=stage.range[1]);
   const done=items.filter(s=>s.state==="completed"||s.state==="skipped").length;
   const current=items.find(s=>s.state==="running"||s.state==="ready");
   return <div key={stage.title} className={`rounded-2xl border p-4 ${done===items.length?"border-emerald-200 bg-emerald-50/50":current?"border-indigo-200 bg-indigo-50/50":"bg-white"}`}>
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">{i+1}. {stage.title}</h3><span className="text-xs text-slate-600">{done===items.length?"已完成":current?"可推进":"等待上游"}</span></div>
    <p className="mt-3 text-xs leading-5 text-slate-600">需要：{stage.input}<br/>产出：{stage.output}</p>
    <p className="mt-2 text-[10px] leading-4 text-slate-400">{stage.closedLoopRole}</p>
    <p className="mt-3 border-t pt-2 text-xs leading-5 text-slate-700">{current?.detail??`${done}/${items.length} 项完成；${i===0?"目标未确认前不开始改写":stage.id==="production"?"离线任务自动跳过生产阶段；在线任务需真实 Outcome":"上游完成后自动衔接"}`}</p>
   </div>;
  })}</section>;
}
