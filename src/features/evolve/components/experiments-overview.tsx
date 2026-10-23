import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  ShieldCheck,
  Sparkles,
  TestTube2,
  TriangleAlert,
  Trophy,
  Archive,
  Compass,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAiProviderStatus } from "../ai/service";
import type { Candidate, EvolveProject } from "../schemas";
import { useLocalProjects } from "../runtime/use-local-projects";

function mutationType(candidate: Candidate) {
  const components = [...new Set(candidate.patches.map((patch) => patch.component))];
  if (components.length > 1) return "组合 / Crossover";
  const component = components[0];
  if (component === "workflow") return "结构 Mutation";
  if (component === "tool" || component === "memory") return "Tool / Memory";
  if (component === "code" || component === "model") return "高风险 Mutation";
  return "局部 Prompt";
}

function experimentStatus(project: EvolveProject) {
  if (project.validationRun.status === "completed") return project.validationRun.recommendation === "release" ? "Holdout Passed" : "Holdout Blocked";
  if (project.experimentRun.status === "completed") return "Offline Completed";
  if (project.experimentRun.status === "running") return "Running";
  return "Planned";
}

export function ExperimentsOverview() {
  const projects = useLocalProjects();
  const rows = useMemo(() => projects.filter((project) => project.candidates.length > 0 || project.experimentRun.status !== "idle" || project.roundHistory.length > 0 || Boolean(project.searchChampion)), [projects]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = rows.find((project) => project.id === selectedId) ?? rows[0];
  const generator = getAiProviderStatus("plan", selected ? { aiProfile: selected.aiProfile } : undefined);
  const evaluator = getAiProviderStatus("evaluate", selected ? { aiProfile: selected.aiProfile } : undefined);
  const totalCandidates = rows.reduce((sum, project) => sum + Math.max(project.candidates.length, project.evolutionArchive.length), 0);
  const winners = rows.reduce((sum, project) => sum + project.roundHistory.filter((round) => Boolean(round.winnerCandidateId)).length, 0);
  const safetyFails = rows.reduce((sum, project) => sum + project.evolutionArchive.filter((entry) => entry.kind === "failure").length + project.candidates.filter((candidate) => candidate.safety === "FAIL").length, 0);
  const holdoutPassed = rows.filter((project) => Boolean(project.searchChampion)).length;

  const winner = selected?.candidates.find((candidate) => candidate.id === selected.experimentRun.winnerId) ?? selected?.candidates.find((candidate) => candidate.recommended);
  const base = selected?.baselineRun.result;

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"><div><div className="text-xs font-semibold text-indigo-600">Evidence & Experiments</div><h1 className="mt-1 text-3xl font-bold">证据与实验</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">解释“为什么系统认为这个版本更好”：统一查看 Candidate 对比、Baseline、Hidden Validation、独立评审、版本血缘与失败证据。它是审计与解释中心，不是普通用户的必经流程。</p></div><div className="flex flex-wrap gap-2"><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700"><Bot className="mr-1 size-3"/>生成：{generator.provider} / {generator.model}</Badge><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><ShieldCheck className="mr-1 size-3"/>评测：{evaluator.provider} / {evaluator.model}</Badge></div></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Candidate 总数" value={totalCandidates} icon={<FlaskConical className="size-4"/>} tone="indigo" />
      <Stat label="Best-of-Round" value={winners} icon={<Sparkles className="size-4"/>} tone="emerald" />
      <Stat label="Best-Ever Champion" value={holdoutPassed} icon={<CheckCircle2 className="size-4"/>} tone="sky" />
      <Stat label="Safety 淘汰" value={safetyFails} icon={<TriangleAlert className="size-4"/>} tone="rose" />
    </div>

    {rows.length===0 ? <Card><CardContent className="py-12 text-center text-sm text-slate-400">完成 Root Cause Diagnosis 与 Evolution Plan 后，这里会出现真正的 Candidate 实验。</CardContent></Card> : <div className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden"><CardContent className="p-0"><div className="border-b px-4 py-4"><div className="font-semibold">实验队列</div><p className="mt-1 text-xs text-slate-400">按项目查看 Population、Winner、Holdout 和失败证据。</p></div><div className="divide-y">{rows.map((project)=>{const w=project.candidates.find((candidate)=>candidate.id===project.experimentRun.winnerId);const active=selected?.id===project.id;return <button key={project.id} onClick={()=>setSelectedId(project.id)} className={`w-full p-4 text-left transition ${active?'bg-indigo-50/60':'hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-2"><div className="font-semibold text-slate-900">{project.name}</div><Badge>{experimentStatus(project)}</Badge></div><div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-400"><span>{project.candidates.length} Current Candidates</span><span>·</span><span>{project.roundHistory.length} Rounds</span><span>·</span><span>{project.evolutionArchive.length} Archive</span></div>{project.searchChampion?<div className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">Best-Ever {project.searchChampion.versionLabel} · Score {project.searchChampion.score.toFixed(1)}</div>:w&&<div className="mt-2 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">Winner {w.id} · Evidence {w.evidence}%</div>}</button>})}</div></CardContent></Card>

      {selected && <div className="space-y-4">
        <Card><CardContent className="pt-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Experiment Evidence</div><h2 className="mt-1 text-xl font-bold">{selected.name} · Population</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">所有 Candidate 都来自同一 Diagnosis / Evolution Plan；实验结果必须能回溯到 Parent、Patch、TestCase、Evaluator 和 Run Trace。</p></div><Link to={`/projects/${selected.id}?stage=${selected.experimentRun.status==='completed'?'experiment':'plan'}`}><Button>打开项目实验 <ArrowRight className="size-3.5"/></Button></Link></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Mini label="Baseline" value={base?`A ${base.accuracy} / E ${base.evidence}`:'未完成'} /><Mini label="Validation" value={`${selected.evalSuite.length} cases`} /><Mini label="Hidden" value={`${selected.hiddenEvalSuite.length} cases`} /><Mini label="Experiment" value={selected.experimentRun.status} /></div>
        </CardContent></Card>

        {selected.roundHistory.length > 0 && <Card><CardContent className="pt-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-2 font-semibold"><Compass className="size-4 text-indigo-600"/>Campaign Search Landscape</div><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">区分 Best-of-Round 和 Best-Ever Search Champion。非冠军 Candidate 不会全部丢弃：不同 niche 的 Elite、Pareto 解和 Stepping Stone 会进入 Archive，供后续 crossover / open-ended branching 使用。</p></div>{selected.searchChampion&&<Badge className="border-amber-200 bg-amber-50 text-amber-700"><Trophy className="mr-1 size-3"/>{selected.searchChampion.versionLabel} · {selected.searchChampion.score.toFixed(1)}</Badge>}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Mini label="Rounds" value={String(selected.roundHistory.length)} /><Mini label="Archive" value={String(selected.evolutionArchive.length)} /><Mini label="Elites" value={String(selected.evolutionArchive.filter((e)=>e.kind==='elite').length)} /><Mini label="Stepping Stones" value={String(selected.evolutionArchive.filter((e)=>e.kind==='stepping-stone').length)} /></div>
          <div className="mt-4 overflow-x-auto rounded-xl border"><table className="w-full min-w-[780px] text-left text-xs"><thead className="bg-slate-50 text-slate-400"><tr><th className="p-2.5">Archive</th><th>Round</th><th>Niche</th><th>Score</th><th>Parent</th><th>Why kept</th></tr></thead><tbody className="divide-y">{[...selected.evolutionArchive].sort((a,b)=>b.round-a.round||b.score-a.score).slice(0,12).map((entry)=><tr key={entry.id}><td className="p-2.5"><Badge className={entry.kind==='champion'?'border-amber-200 bg-amber-50 text-amber-700':entry.kind==='elite'?'border-indigo-200 bg-indigo-50 text-indigo-700':entry.kind==='failure'?'border-rose-200 bg-rose-50 text-rose-700':'border-sky-200 bg-sky-50 text-sky-700'}>{entry.kind}</Badge></td><td>R{entry.round}</td><td>{entry.niche}</td><td className="font-semibold">{entry.score.toFixed(1)}</td><td className="text-[10px] text-slate-400">{entry.parentVersionId||'—'}</td><td className="max-w-[300px] text-[10px] leading-4 text-slate-500">{entry.reason}</td></tr>)}</tbody></table></div>
          {selected.evolutionArchive.length===0&&<div className="mt-4 rounded-xl border border-dashed p-5 text-center text-xs text-slate-400"><Archive className="mx-auto mb-2 size-5"/>完成 Campaign Round 后，这里会形成 Evolution Archive。</div>}
        </CardContent></Card>}

        <Card><CardContent className="pt-5"><div className="flex items-center justify-between"><div><div className="font-semibold">Candidate Population</div><p className="mt-1 text-xs text-slate-400">保留差异化探索，而不是只做单线 Prompt hill-climbing。</p></div><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700"><GitBranch className="mr-1 size-3"/>Lineage {selected.version}</Badge></div>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="text-slate-400"><tr><th className="pb-2">Candidate</th><th>Mutation</th><th>Accuracy</th><th>Evidence</th><th>Risk</th><th>Cost Δ</th><th>Speed Δ</th><th>Safety</th><th>Status</th></tr></thead><tbody className="divide-y">{selected.candidates.map((candidate)=><tr key={candidate.id} className={candidate.id===winner?.id?'bg-emerald-50/50':''}><td className="py-3 pr-3"><div className="font-semibold text-slate-900">{candidate.id} · {candidate.title || candidate.name}</div><div className="mt-1 max-w-[260px] text-[10px] leading-4 text-slate-400">{candidate.hypothesis || candidate.change}</div></td><td className="pr-3"><Badge>{mutationType(candidate)}</Badge></td><td className="font-semibold">{candidate.accuracy||'—'}</td><td className="font-semibold">{candidate.evidence||'—'}</td><td>{candidate.riskCoverage||'—'}</td><td className={candidate.costDelta<=0?'text-emerald-600':'text-rose-500'}>{candidate.costDeltaKnown===false?"未测":`${candidate.costDelta}%`}</td><td className={candidate.speedDelta>=0?'text-emerald-600':'text-rose-500'}>{candidate.speedDeltaKnown===false?"未测":`${candidate.speedDelta}%`}</td><td><Badge className={candidate.safety==='PASS'?'border-emerald-200 bg-emerald-50 text-emerald-700':candidate.safety==='FAIL'?'border-rose-200 bg-rose-50 text-rose-700':'border-amber-200 bg-amber-50 text-amber-700'}>{candidate.safety}</Badge></td><td>{candidate.status}</td></tr>)}</tbody></table></div>
        </CardContent></Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardContent className="pt-5"><div className="flex items-center gap-2 font-semibold"><TestTube2 className="size-4 text-indigo-600"/>验证协议</div><div className="mt-4 space-y-2 text-xs"><Protocol label="Sandbox / Basic" done={selected.experimentRun.status==='completed'} detail="所有 Candidate 在 Target Adapter 中隔离运行"/><Protocol label="统一 Eval" done={selected.experimentRun.status==='completed'} detail={`Independent Judge：${evaluator.provider} / ${evaluator.model}`}/><Protocol label="Hidden Holdout" done={selected.validationRun.status==='completed'} detail={`${selected.hiddenEvalSuite.length} 个 Candidate 不可见 Case`}/><Protocol label="Release Review" done={selected.validationRun.recommendation==='release'} detail={selected.validationRun.summary || '等待独立发布审查'}/></div></CardContent></Card>
          <Card><CardContent className="pt-5"><div className="flex items-center gap-2 font-semibold"><GitBranch className="size-4 text-indigo-600"/>版本血缘与实验结论</div><div className="mt-4 flex items-center gap-2 text-xs"><span className="rounded-xl border bg-slate-50 px-3 py-2 font-semibold">{selected.version}</span><ArrowRight className="size-3.5 text-slate-300"/><div className="flex flex-wrap gap-1">{selected.candidates.map((candidate)=><span key={candidate.id} title={candidate.id} className={`max-w-40 truncate rounded-xl border px-3 py-2 font-semibold ${candidate.id===winner?.id?'border-emerald-200 bg-emerald-50 text-emerald-700':'bg-white text-slate-500'}`}>{candidate.id}</span>)}</div></div><div className="mt-4 rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-500">{selected.experimentRun.summary || '实验尚未完成。运行后这里会记录 Winner 选择理由、Hard Gate 淘汰原因和非 Winner 的保留价值。'}</div></CardContent></Card>
        </div>
      </div>}
    </div>}
  </div>;
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "indigo"|"emerald"|"sky"|"rose" }) {
  const styles={indigo:"bg-indigo-50 text-indigo-600",emerald:"bg-emerald-50 text-emerald-600",sky:"bg-sky-50 text-sky-600",rose:"bg-rose-50 text-rose-600"};
  return <Card><CardContent className="flex items-center gap-3 pt-5"><div className={`grid size-10 place-items-center rounded-xl ${styles[tone]}`}>{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-slate-400">{label}</div></div></CardContent></Card>;
}
function Mini({label,value}:{label:string;value:string}) { return <div className="rounded-xl border bg-slate-50 p-3"><div className="text-[10px] text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold text-slate-800">{value}</div></div>; }
function Protocol({label,done,detail}:{label:string;done:boolean;detail:string}) { return <div className="flex items-start gap-2 rounded-xl border p-3"><div className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${done?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-400'}`}>{done?<CheckCircle2 className="size-3"/>:<span className="size-1.5 rounded-full bg-current"/>}</div><div><div className="font-semibold text-slate-700">{label}</div><div className="mt-0.5 text-[10px] leading-4 text-slate-400">{detail}</div></div></div>; }
