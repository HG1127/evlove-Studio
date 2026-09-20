import { useMemo, useState } from "react";
import { CheckCircle2, FileText, GitCompareArrows, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EvolveProject, OutputArtifact } from "../schemas";
import { compactDiffLines, diffLines } from "../runtime/diff";

type ReviewTab = "preview" | "diff" | "evidence";

function targetSourceFor(project: EvolveProject, artifact?: OutputArtifact) {
  if (!artifact) return undefined;
  const sourceId = artifact.sourceArtifactIds?.[0];
  return project.sourceArtifacts.find((item) => item.id === sourceId)
    ?? project.sourceArtifacts.find((item) => item.role === "target" && item.name === artifact.name)
    ?? project.sourceArtifacts.find((item) => item.role === "target");
}

export function ArtifactReviewModal({ project, onClose }: { project: EvolveProject; onClose: () => void }) {
  const primary = useMemo(() => project.outputArtifacts.filter((item) => item.kind === "primary"), [project.outputArtifacts]);
  const [selectedId, setSelectedId] = useState(primary[0]?.id ?? "");
  const [tab, setTab] = useState<ReviewTab>("preview");
  const artifact = primary.find((item) => item.id === selectedId) ?? primary[0];
  const source = targetSourceFor(project, artifact);
  const original = source?.textContent || source?.textExcerpt || "";
  const current = artifact?.content || "";
  const diff = useMemo(() => diffLines(original.split("\n"), current.split("\n")), [original, current]);
  const compact = useMemo(() => compactDiffLines(diff.lines, 2), [diff.lines]);
  const acceptance = project.searchChampion?.artifactAcceptance ?? project.artifactAcceptance;

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4" onClick={onClose}>
    <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.14em] text-emerald-600">Artifact Review</div>
          <div className="mt-1 text-lg font-bold text-slate-950">{project.name} · {project.searchChampion?.versionLabel ?? project.version}</div>
          <div className="mt-1 text-xs text-slate-500">在当前成果页完成预览、差异检查和验收证据复核；无需跳转任务页。</div>
        </div>
        <Button variant="ghost" size="sm" className="size-8 p-0" onClick={onClose} aria-label="关闭成果查看"><X className="size-4" /></Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <div className="flex overflow-hidden rounded-lg border">
          <TabButton active={tab === "preview"} onClick={() => setTab("preview")}><FileText className="size-3.5" />成果预览</TabButton>
          <TabButton active={tab === "diff"} onClick={() => setTab("diff")}><GitCompareArrows className="size-3.5" />与原版差异</TabButton>
          <TabButton active={tab === "evidence"} onClick={() => setTab("evidence")}><ShieldCheck className="size-3.5" />验收依据</TabButton>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5 text-xs">
          <Badge className={acceptance?.status === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>系统验收 · {acceptance?.status ?? "pending"}</Badge>
          {acceptance?.coverageScore !== undefined && <Badge>Coverage {acceptance.coverageScore}</Badge>}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="max-h-40 overflow-auto border-b bg-slate-50/70 p-2 md:max-h-none md:border-b-0 md:border-r">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">正式主成果</div>
          {primary.length ? primary.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("mb-1 w-full rounded-lg px-3 py-2 text-left text-xs transition", item.id === artifact?.id ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-white")}>
            <div className="truncate">{item.name}</div>
            <div className="mt-0.5 text-[10px] font-normal text-slate-400">{(item.content.length / 1024).toFixed(1)} KB · {item.accepted ? "已验收" : "未验收"}</div>
          </button>) : <div className="p-3 text-xs text-slate-400">暂无正式主成果。</div>}
        </aside>

        <main className="min-h-0 overflow-auto bg-white">
          {tab === "preview" && <div className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-semibold text-slate-800">{artifact?.name ?? "成果"}</div><div className="mt-1 text-xs text-slate-400">当前正式交付快照</div></div>{artifact?.accepted && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 size-3" />Gate F 已通过</Badge>}</div>
            <pre className="min-h-64 whitespace-pre-wrap break-words rounded-xl border bg-slate-50 p-4 font-mono text-xs leading-6 text-slate-700">{current || "当前成果没有可直接预览的文本内容。"}</pre>
          </div>}

          {tab === "diff" && <div className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-semibold">与原始版本的真实差异</div><div className="mt-1 text-xs text-slate-400">默认只展示变化及少量上下文，不重复展示整份原文。</div></div><Badge>+{diff.added} / -{diff.deleted}</Badge></div>
            {!original ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">没有找到对应原始文本，无法生成可靠差异；可进入完整任务查看版本血缘。</div> : diff.added === 0 && diff.deleted === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">当前成果与原版文本一致。</div> : <div className="rounded-xl border bg-slate-50 p-3 font-mono text-[11px] leading-5">{compact.map((line, index) => line.type === "skip" ? <div key={index} className="my-1 rounded bg-slate-100 px-2 py-1 text-center text-[10px] text-slate-400">… 省略 {line.count} 行未变化内容 …</div> : <div key={index} className={cn("whitespace-pre-wrap rounded px-2", line.type === "add" ? "bg-emerald-50 text-emerald-800" : line.type === "del" ? "bg-rose-50 text-rose-700" : "text-slate-400")}>{line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}{line.text}</div>)}</div>}
          </div>}

          {tab === "evidence" && <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Overall" value={acceptance?.overallScore} />
              <Metric label="Coverage" value={acceptance?.coverageScore} />
              <Metric label="Integrity" value={acceptance?.integrityScore} />
              <Metric label="Pairwise" value={acceptance?.pairwiseScore} />
            </div>
            <section className="rounded-xl border p-4"><div className="text-xs font-semibold text-slate-800">验收结论</div><p className="mt-2 text-sm leading-6 text-slate-600">{acceptance?.summary || "暂无验收摘要。"}</p></section>
            {artifact?.frozenArtifact && <section className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4"><div className="text-xs font-semibold text-emerald-800">实际文件验证</div><ul className="mt-2 space-y-1 text-xs leading-5 text-slate-700">{artifact.frozenArtifact.checks.map((check) => <li key={check}>✓ {check}</li>)}</ul>{artifact.frozenArtifact.limitations.map((item) => <p key={item} className="mt-2 text-xs text-amber-800">限制：{item}</p>)}</section>}
            <p className="text-xs leading-5 text-slate-400">这里展示的是当前正式成果对应的机器验收依据；用户点击“确认验收”后，Mission 才进入最终完成状态。</p>
          </div>}
        </main>
      </div>
    </div>
  </div>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("flex items-center gap-1.5 px-3 py-2 text-xs font-semibold", active ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>{children}</button>;
}

function Metric({ label, value }: { label: string; value?: number }) {
  return <div className="rounded-xl border bg-slate-50 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value ?? "—"}</div></div>;
}
