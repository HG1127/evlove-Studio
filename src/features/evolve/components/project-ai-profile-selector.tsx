import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Check, CheckCircle2, ChevronDown, ExternalLink, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectAiProfile, ProjectModelRoute } from "../schemas";
import type { AiOperation } from "../ai/schemas";
import { listTestedModelChoices } from "../ai/providers/registry";

type ModelChoice = ReturnType<typeof listTestedModelChoices>[number];

export function defaultProjectAiProfile(): ProjectAiProfile {
  const choices=listTestedModelChoices();
  if(!choices.length) return {mode:"global"};
  const primary=choices[0]!;
  const route:ProjectModelRoute={connectionId:primary.connectionId,model:primary.model,label:primary.label};
  return {mode:"project",primary:route,judge:route,builder:route,copilot:route};
}

function EmptyModelNotice(){
  return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800"><div className="flex items-center gap-2 font-semibold"><Bot className="size-4"/>还没有“测试通过”的模型</div><p className="mt-1">先到「AI 模型与连接」测试模型。创建项目时只允许选择已经实际连接成功的模型，避免运行到一半才发现 model 不可用。</p><Link to="/settings" className="mt-2 inline-flex items-center gap-1 font-semibold text-amber-900">前往设置 <ExternalLink className="size-3"/></Link></div>;
}

const routeOf=(choice:ModelChoice):ProjectModelRoute=>({connectionId:choice.connectionId,model:choice.model,label:choice.label});
const keyOf=(route?:ProjectModelRoute)=>route?`${route.connectionId}::${route.model}`:"";

/** 单选模型列表：在项目页传入 operations 时，仅覆盖当前节点会发起的 AI 调用。 */
function ModelOptionList({value,onChange,choices,columns,operations}:{value:ProjectAiProfile;onChange:(next:ProjectAiProfile)=>void;choices:ModelChoice[];columns:string;operations?:AiOperation[]}){
  const scopedRoute=operations?.length?value.operationRoutes?.[operations[0]!]:undefined;
  const activeKey=value.mode==="project"?keyOf(scopedRoute??value.primary):"";
  const pick=(choice?:ModelChoice)=>{
    if(operations?.length){
      const operationRoutes={...(value.operationRoutes??{})};
      if(choice) for(const operation of operations) operationRoutes[operation]=routeOf(choice);
      else for(const operation of operations) delete operationRoutes[operation];
      onChange({...value,mode:"project",operationRoutes});
      return;
    }
    onChange(choice?{mode:"project",primary:routeOf(choice),judge:routeOf(choice),builder:routeOf(choice),copilot:routeOf(choice),operationRoutes:{}}:{mode:"global",operationRoutes:{}});
  };
  return <div className={columns}>
    <button type="button" onClick={()=>pick(undefined)} className={cn("flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition",value.mode==="global"?"border-indigo-300 bg-indigo-50/70 text-indigo-700":"border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700")}><span className="truncate">使用全局路由</span>{value.mode==="global"&&<Check className="size-3.5 shrink-0"/>}</button>
    {choices.map((choice)=>{const key=`${choice.connectionId}::${choice.model}`;const active=activeKey===key;return <button key={key} type="button" onClick={()=>pick(choice)} className={cn("flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition",active?"border-indigo-300 bg-indigo-50/70 text-indigo-700":"border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700")}><span className="truncate">{choice.label}</span>{active&&<Check className="size-3.5 shrink-0"/>}</button>;})}
  </div>;
}

export function ProjectAiProfileSelector({value,onChange,compact=false,operations,scopeLabel}:{value:ProjectAiProfile;onChange:(next:ProjectAiProfile)=>void;compact?:boolean;operations?:AiOperation[];scopeLabel?:string}){
  const choices=useMemo(()=>listTestedModelChoices(),[]);
  if(!choices.length) return <EmptyModelNotice/>;
  return <div className="rounded-2xl border bg-slate-50/70 p-3">
    <div className="flex items-center justify-between gap-2"><div><div className="text-xs font-semibold text-slate-800">{scopeLabel?`${scopeLabel} · AI 模型`:"本项目 AI 模型"}</div><div className="mt-0.5 text-[10px] text-slate-400">{operations?.length?"只影响当前节点之后的真实执行；右侧 Copilot 使用独立 copilot 路由。其他已验证节点不会失效。":"选择本项目默认模型；只显示连接测试成功的模型。"}</div></div><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 size-3"/>{choices.length} tested</Badge></div>
    <div className="mt-3"><ModelOptionList value={value} onChange={onChange} choices={choices} operations={operations} columns={compact?"grid gap-2 sm:grid-cols-2 lg:grid-cols-3":"grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}/></div>
  </div>;
}

export function ProjectModelSwitcher({value,onChange}:{value:ProjectAiProfile;onChange:(next:ProjectAiProfile)=>void;}){
  const choices=useMemo(()=>listTestedModelChoices(),[]);
  const [menuOpen,setMenuOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!menuOpen) return;
    const handlePointerDown=(event:PointerEvent)=>{ if(rootRef.current&&!rootRef.current.contains(event.target as Node)) setMenuOpen(false); };
    const handleKeyDown=(event:KeyboardEvent)=>{ if(event.key==="Escape") setMenuOpen(false); };
    window.addEventListener("pointerdown",handlePointerDown);
    window.addEventListener("keydown",handleKeyDown);
    return ()=>{ window.removeEventListener("pointerdown",handlePointerDown); window.removeEventListener("keydown",handleKeyDown); };
  },[menuOpen]);
  const primary=choices.find((choice)=>keyOf(value.primary)===`${choice.connectionId}::${choice.model}`);
  const triggerLabel=value.mode==="project"&&primary?primary.model:"AI 模型";
  return <div ref={rootRef} className="relative">
    <button type="button" aria-expanded={menuOpen} title="选择当前节点要用的模型" onClick={()=>setMenuOpen((current)=>!current)} className={cn("flex h-8 max-w-52 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition",menuOpen?"border-indigo-300 bg-indigo-50/70 text-indigo-700":choices.length?"border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700":"border-amber-200 bg-amber-50 text-amber-700")}>
      <Sparkles className="size-3.5 shrink-0 text-indigo-500"/><span className="truncate">{triggerLabel}</span><ChevronDown className={cn("size-3.5 shrink-0 text-slate-400 transition",menuOpen&&"rotate-180")}/>
    </button>
    {menuOpen&&<div className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-xl shadow-slate-300/40">
      {choices.length?<>
        <div className="flex items-center justify-between gap-2 px-0.5"><div className="text-[10px] font-semibold text-slate-400">选择当前节点要用的模型</div><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{choices.length} tested</Badge></div>
        <div className="mt-2 max-h-[min(360px,55vh)] space-y-1 overflow-y-auto"><ModelOptionList value={value} onChange={(next)=>{onChange(next);if(next.mode==="project")setMenuOpen(false);}} choices={choices} columns="grid"/></div>
        <Link to="/settings" className="mt-2 flex items-center justify-center gap-1 rounded-xl border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700">管理连接与测试模型 <ExternalLink className="size-3"/></Link>
      </>:<EmptyModelNotice/>}
    </div>}
  </div>;
}
