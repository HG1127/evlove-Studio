import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, BrainCircuit, CircleAlert, Layers3, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocalProjects } from "../runtime/use-local-projects";

export function SystemInsightsOverview(){
  const projects=useLocalProjects({includeDemo:false});
  const rows=useMemo(()=>projects.flatMap(project=>project.problems.map(problem=>({project,problem}))),[projects]);
  const unresolved=rows.filter(({problem})=>problem.status!=="resolved");
  const high=unresolved.filter(({problem})=>problem.severity==="high");
  const byComponent=useMemo(()=>{
    const counts=new Map<string,number>();
    for(const {problem} of unresolved){const key=(problem.affectedComponent||"未归类").trim()||"未归类";counts.set(key,(counts.get(key)||0)+1)}
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  },[unresolved]);
  const stopReasons=projects.filter(p=>p.campaign.stopReason).map(p=>({name:p.name,reason:p.campaign.stopReason!})).slice(0,8);
  return <div className="space-y-5">
    <section><div className="text-xs font-semibold text-indigo-600">System Intelligence</div><h1 className="mt-1 text-3xl font-bold">系统洞察</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">从多个进化任务的真实问题、停止原因与重复组件中找系统性改进机会。当前为确定性聚合，不把简单分组伪装成 AI 语义聚类。</p></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat icon={<Layers3 className="size-4"/>} label="任务" value={projects.length}/><Stat icon={<CircleAlert className="size-4"/>} label="未解决问题" value={unresolved.length}/><Stat icon={<TriangleAlert className="size-4"/>} label="高严重度" value={high.length}/><Stat icon={<Activity className="size-4"/>} label="有停止原因" value={stopReasons.length}/></div>
    <div className="grid gap-4 xl:grid-cols-2"><Card><CardContent className="pt-5"><div className="flex items-center gap-2 font-semibold"><BrainCircuit className="size-4 text-indigo-600"/>高频受影响组件</div><p className="mt-1 text-xs text-slate-400">帮助发现“同类问题是否在多个任务反复出现”。</p><div className="mt-4 space-y-2">{byComponent.length?byComponent.map(([name,count])=><div key={name} className="flex items-center justify-between rounded-xl border bg-slate-50 p-3"><span className="text-xs font-semibold text-slate-700">{name}</span><Badge>{count} 次</Badge></div>):<div className="text-xs text-slate-400">暂无可聚合的问题。</div>}</div></CardContent></Card><Card><CardContent className="pt-5"><div className="font-semibold">最近安全停止 / 阻塞原因</div><p className="mt-1 text-xs text-slate-400">这里只展示真实项目状态，不推断尚未发生的根因。</p><div className="mt-4 space-y-2">{stopReasons.length?stopReasons.map(item=><div key={`${item.name}:${item.reason}`} className="rounded-xl border p-3"><div className="text-xs font-semibold">{item.name}</div><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{item.reason}</p></div>):<div className="text-xs text-slate-400">暂无停止记录。</div>}</div></CardContent></Card></div>
    <div className="flex flex-wrap gap-2"><Link to="/problems"><Button>查看问题明细 <ArrowRight className="size-3.5"/></Button></Link><Link to="/experiments"><Button variant="secondary">查看证据与实验</Button></Link></div>
    <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs leading-5 text-sky-800"><b>下一阶段：</b>接入后台 Event Store 后，再做跨任务语义聚类、失败模式趋势、模型路由故障归因和“为 Evolve 自己创建 System Evolution Mission”。</div>
  </div>;
}
function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:number}){return <Card><CardContent className="flex items-center gap-3 pt-5"><div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600">{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div></CardContent></Card>}
