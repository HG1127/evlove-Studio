
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Activity, ArrowRight, BookOpenCheck, Boxes, CircleAlert, FlaskConical, PackageCheck, RotateCcw, Rocket, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalProjects } from "../runtime/use-local-projects";
import { getLiveRun, getRunTask, shouldResumeTask, subscribeLiveRuns } from "../runtime/run-manager";
import { EvolutionComposer } from "./evolution-composer";
import { deriveNextWorkflowAction, deriveWorkflowSteps } from "../runtime/workflow-engine";

const stageText = { target: "目标确认", baseline: "当前基线", problem: "问题发现", diagnosis: "根因诊断", plan: "进化方案", experiment: "进化实验", validation: "验证选优", release: "发布验证", learning: "经验沉淀" } as const;

function pendingGate(project: ReturnType<typeof useLocalProjects>[number]) {
  const target = project.gates.find((g) => g.id === "target-ready");
  const experiment = project.gates.find((g) => g.id === "experiment-ready");
  const release = project.gates.find((g) => g.id === "release-ready");
  if (target?.status !== "approved") return { label: "Gate 1 · 确认进化目标", stage: "target" };
  if (project.candidates.length > 0 && experiment?.status !== "approved") return { label: "Gate 2 · 确认实验范围", stage: "plan" };
  if (project.validationRun.status === "completed" && release?.status !== "approved") return { label: "Gate 3 · 确认发布", stage: "validation" };
  return undefined;
}

export function DashboardOverview() {
  const projects = useLocalProjects();
  const recent = projects.slice(0, 6);
  const problems = projects.flatMap((p) => p.problems.filter((x) => x.status !== "resolved"));
  const candidates = projects.reduce((sum, p) => sum + p.candidates.length, 0);
  const lessons = projects.reduce((sum, p) => sum + p.lessons.length, 0);
  const confirmations = projects.map((p) => ({ project: p, gate: pendingGate(p) })).filter((x) => x.gate).slice(0, 3);
  // 首页也能看见「哪个项目在后台跑 / 哪个被打断等着续跑」，不用进项目列表才知道。
  const [runTick, setRunTick] = useState(0);
  useEffect(() => {
    const bump = () => setRunTick((value) => value + 1);
    const unsubscribe = subscribeLiveRuns(bump);
    window.addEventListener("evolve-run-tasks-changed", bump);
    window.addEventListener("evolve-projects-changed", bump);
    return () => {
      unsubscribe();
      window.removeEventListener("evolve-run-tasks-changed", bump);
      window.removeEventListener("evolve-projects-changed", bump);
    };
  }, []);
  const runningNow = projects.filter((p) => Boolean(getLiveRun(p.id)));
  const interruptedNow = projects.filter((p) => !getLiveRun(p.id) && (() => { const task = getRunTask(p.id); return Boolean(task && shouldResumeTask(task)); })());
  const runStateOf = (projectId: string) => {
    void runTick;
    const live = getLiveRun(projectId);
    if (live) return { kind: "running" as const, label: live.label ?? "节点运行中" };
    const task = getRunTask(projectId);
    if (task && shouldResumeTask(task)) return { kind: "interrupted" as const, label: task.label };
    return undefined;
  };
  const stats = [
    { icon: Sparkles, value: String(projects.length), title: "进化项目" },
    { icon: CircleAlert, value: String(problems.length), title: "待解决问题" },
    { icon: FlaskConical, value: String(candidates), title: "候选版本" },
    { icon: BookOpenCheck, value: String(lessons), title: "已沉淀经验" },
  ];

  return <div className="space-y-4">
    {/* 页头压成一行，把垂直空间让给聊天输入区 */}
    <section className="flex flex-wrap items-baseline justify-between gap-2">
      <div><h1 className="text-2xl font-bold tracking-tight text-slate-950">进化工作台</h1><p className="mt-1 text-sm text-slate-500">上传当前版本，说明目标，让每次改进都有可验证的成果。</p></div>
      <Link to="/projects" className="text-xs font-medium text-indigo-600 hover:underline">全部项目 →</Link>
    </section>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{stats.map(({icon:Icon,value,title},index)=><Card key={title}><CardContent className="flex items-center justify-between gap-3 p-4"><div><div className="text-xs font-medium text-slate-500">{title}</div><div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</div></div><div className={`grid size-11 shrink-0 place-items-center rounded-xl ${["bg-indigo-50 text-indigo-600","bg-amber-50 text-amber-600","bg-sky-50 text-sky-600","bg-emerald-50 text-emerald-600"][index]}`}><Icon className="size-5"/></div></CardContent></Card>)}</div>

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0"><EvolutionComposer compact /></div>
      <div className="space-y-3">
        {(runningNow.length > 0 || interruptedNow.length > 0) && (
          <Card>
            <CardHeader className="px-4 pb-2 pt-4"><CardTitle className="text-xs text-slate-500">运行中的进化</CardTitle></CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              {runningNow.map((project) => {
                const state = runStateOf(project.id);
                return <Link key={project.id} to={`/projects/${project.id}`} className="flex items-center gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5 transition hover:border-indigo-200" title="该项目正在后台运行，退出界面不会中断；点击查看实时进度">
                  <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-600"><Activity className="size-3.5 animate-pulse"/></div>
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{project.name}</div><div className="truncate text-[10px] text-indigo-600">后台运行中 · {state?.label}</div></div>
                  <ArrowRight className="size-3.5 shrink-0 text-indigo-300"/>
                </Link>;
              })}
              {interruptedNow.map((project) => {
                const task = getRunTask(project.id);
                return <Link key={project.id} to={`/projects/${project.id}`} className="flex items-center gap-2.5 rounded-xl border border-amber-100 bg-amber-50/50 p-2.5 transition hover:border-amber-200" title="刷新或关闭页面打断了该节点；打开项目会自动从中断处续跑">
                  <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600"><RotateCcw className="size-3.5"/></div>
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{project.name}</div><div className="truncate text-[10px] text-amber-700">运行被打断 · 打开自动续跑：{task?.label}</div></div>
                  <ArrowRight className="size-3.5 shrink-0 text-amber-300"/>
                </Link>;
              })}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="px-4 pb-2 pt-4"><CardTitle className="text-xs text-slate-500">需要你确认</CardTitle></CardHeader>
          <CardContent className="space-y-2 px-4 pb-4">
            {confirmations.length === 0
              ? <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">目前没有需要你确认的事项。</div>
              : confirmations.map(({ project, gate }) => <div key={`${project.id}-${gate!.label}`} className="flex items-center gap-2.5 rounded-xl border p-2.5">
                  <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600"><Rocket className="size-3.5"/></div>
                  <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{project.name}</div><div className="text-[10px] text-slate-400">{gate!.label}</div></div>
                  <Link to={`/projects/${project.id}?stage=${gate!.stage}`}><Button variant="secondary" size="sm" className="h-7 px-2 text-xs">查看</Button></Link>
                </div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="px-4 pb-2 pt-4"><CardTitle className="text-sm text-slate-800">系统会怎样处理？</CardTitle></CardHeader>
          <CardContent className="space-y-2 px-4 pb-4">
            {[["读懂材料与目标","自动解析文件，先与你核对理解和修改边界。"],["聚焦最值得改的问题","按优先级定位相关模块，生成真实候选文件。"],["验证后再交付","与原版对照，保留通过内容，继续修复失败项。"]].map(([title,description],index)=><div key={title} className="flex gap-3 rounded-xl bg-slate-50 p-3"><span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-indigo-100 text-xs font-bold text-indigo-600">{index+1}</span><div><div className="text-xs font-semibold text-slate-800">{title}</div><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div>)}
          </CardContent>
        </Card>
      </div>
    </div>

    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-slate-900">继续你的进化</h2><Link to="/projects" className="text-xs text-indigo-600 hover:underline">查看全部项目</Link></div>
      {recent.length ? <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{recent.map(project=>{const workflow=deriveWorkflowSteps(project);const complete=workflow.filter(item=>item.state==="completed").length;const next=deriveNextWorkflowAction(project);return <Link key={project.id} to={`/projects/${project.id}`} className="focus-ring group min-w-0 rounded-2xl bg-white p-4 soft-shadow transition hover:bg-indigo-50/60"><div className="flex items-center gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Sparkles className="size-5"/></div><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-slate-900">{project.name}</h3><p className="mt-1 text-xs text-slate-500">{stageText[project.stage]}</p></div><ArrowRight className="size-4 text-slate-400 transition group-hover:text-indigo-600"/></div><p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">下一步：{next.label}</p><div className="mt-3 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{width:`${Math.round(complete/workflow.length*100)}%`}}/></div><span className="text-xs tabular-nums text-slate-500">{complete}/{workflow.length} 步</span></div></Link>})}</div> : <div className="rounded-2xl bg-white p-4 text-sm leading-6 text-slate-500">上传当前成果并确认 AI 的理解后，你的项目和进展会显示在这里。</div>}
    </section>
    <div className="grid gap-3 md:grid-cols-3">{[{href:"/templates",icon:Boxes,title:"从任务模板开始",description:"复用成熟目标和验收方式"},{href:"/outputs",icon:PackageCheck,title:"领取已验收成果",description:"查看文件、版本与验证依据"},{href:"/campaigns",icon:Rocket,title:"管理持续进化",description:"查看自动任务与下一轮安排"}].map(({href,icon:Icon,title,description})=><Link key={href} to={href} className="focus-ring flex items-center gap-3 rounded-xl bg-slate-200/55 p-3 transition hover:bg-white"><Icon className="size-5 shrink-0 text-slate-500"/><div className="min-w-0 flex-1"><div className="text-xs font-semibold text-slate-700">{title}</div><div className="mt-0.5 text-xs text-slate-500">{description}</div></div><ArrowRight className="size-3.5 text-slate-400"/></Link>)}</div>
  </div>;
}
