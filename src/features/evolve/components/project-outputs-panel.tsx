import { ArchiveRestore, Boxes, Download, Eye, FileArchive, FileText, GitBranch, GitCompareArrows, History, PackageCheck, Rocket, RotateCcw, Trophy, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { EvolvedVersion, OutputArtifact } from "../schemas";
import { diffLines, compactDiffLines, projectFullDiffSides } from "../runtime/diff";
import { MermaidBlock } from "./mermaid-block";
import { splitMermaidSegments } from "../runtime/mermaid-split";
import { buildDeliverableZip } from "../runtime/artifact-output-builders";
import { readFrozenArtifact } from "../runtime/frozen-artifact";
import { toast } from "sonner";
import type { ProjectRuntime } from "../runtime/use-project-runtime";

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
type DownloadableArtifact = { id: string; name: string; content: string; mimeType?: string; kind?: OutputArtifact["kind"]; accepted?: boolean; sourceArtifactIds?: string[]; description?: string; createdAt?: string; frozenArtifact?: OutputArtifact["frozenArtifact"] };
const iconByKind: Record<OutputArtifact["kind"], React.ReactNode> = {
  primary: <PackageCheck className="size-4" />,
  "patch-bundle": <GitBranch className="size-4" />,
  manifest: <Boxes className="size-4" />,
  scorecard: <Trophy className="size-4" />,
  "release-notes": <FileText className="size-4" />,
  lineage: <ArchiveRestore className="size-4" />,
  "search-summary": <FileArchive className="size-4" />,
  "acceptance-report": <PackageCheck className="size-4" />,
  "requirement-matrix": <FileText className="size-4" />,
};

const sourceLabel: Record<string, string> = {
  validation: "盲测冻结",
  promote: "发布",
  "rollback-snapshot": "自动快照",
  manual: "手动",
};

/** 两版本的成果物按同源附件配对：优先 sourceArtifactId，其次文件名；单边独有的文件也列出。 */
function pairArtifacts(older: EvolvedVersion, newer: EvolvedVersion) {
  const used = new Set<string>();
  const pairs: Array<{ label: string; left?: string; right?: string }> = [];
  for (const left of older.artifacts) {
    const right = newer.artifacts.find((item) => item.sourceArtifactId === left.sourceArtifactId && !used.has(item.id))
      ?? newer.artifacts.find((item) => item.name === left.name && !used.has(item.id));
    if (right) used.add(right.id);
    pairs.push({ label: left.name, left: left.content, right: right?.content });
  }
  for (const right of newer.artifacts) if (!used.has(right.id)) pairs.push({ label: right.name, left: undefined, right: right.content });
  return pairs;
}

/** 版本差异对比弹层：默认只展示真实变化；完整左右全文降级为审计/复核模式。 */
function VersionDiffModal({ versions, initialOlderId, initialNewerId, onRollback, onClose }: { versions: EvolvedVersion[]; initialOlderId: string; initialNewerId: string; onRollback: (versionId: string) => void; onClose: () => void }) {
  const [olderId, setOlderId] = useState(initialOlderId);
  const [newerId, setNewerId] = useState(initialNewerId);
  const older = versions.find((version) => version.id === olderId);
  const newer = versions.find((version) => version.id === newerId);
  const [rollbackArm, setRollbackArm] = useState<"old" | "new" | null>(null);
  const armRollback = (side: "old" | "new") => {
    setRollbackArm(side);
    window.setTimeout(() => setRollbackArm((current) => (current === side ? null : current)), 4000);
  };
  // 原文是基准不是版本、回滚快照本身不可再回滚：这两类不显示回滚入口。
  const rollbackable = (version?: EvolvedVersion) => Boolean(version && version.id !== "__source__" && version.source !== "rollback-snapshot" && version.artifacts.length > 0);
  const pairs = useMemo(() => (older && newer ? pairArtifacts(older, newer) : []), [older, newer]);
  const [pairIndex, setPairIndex] = useState(0);
  const [mode, setMode] = useState<"side" | "unified">("unified");
  const pair = pairs[Math.min(pairIndex, pairs.length - 1)];
  const diff = useMemo(
    () => diffLines((pair?.left ?? "").split("\n"), (pair?.right ?? "").split("\n")),
    [pair],
  );
  const compactDiff = useMemo(() => compactDiffLines(diff.lines, 1), [diff]);
  const fullSides = useMemo(() => projectFullDiffSides(diff.lines), [diff]);
  const fullLineClass = (kind: "same" | "del" | "add") => kind === "del" ? "bg-rose-50 text-rose-700" : kind === "add" ? "bg-emerald-50 text-emerald-800" : "text-slate-600";
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
    <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="border-b px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold">版本对比</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={pairs.length === 0} onClick={() => {
              if (!older || !newer) return;
              const sections = pairs.map((item) => {
                const d = diffLines((item.left ?? "").split("\n"), (item.right ?? "").split("\n"));
                const body = compactDiffLines(d.lines, 1).map((line) => line.type === "skip" ? `… 省略 ${line.count} 行未变化内容 …` : `${line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}${line.text}`).join("\n");
                return `## ${item.label}\n\n${item.left === undefined ? "> 仅新版本有该文件\n\n" : item.right === undefined ? "> 仅旧版本有该文件\n\n" : ""}> ${d.added} 行新增 / ${d.deleted} 行删除${d.truncated ? "（内容过长，已降级为整段对照）" : ""}\n\n\`\`\`diff\n${body}\n\`\`\``;
              }).join("\n\n");
              const content = `# 版本对比 · ${older.label} → ${newer.label}\n\n> 导出时间：${new Date().toLocaleString("zh-CN")}\n> 旧 → 新：+ 为新增行、- 为删除行\n\n${sections}\n`;
              downloadBlob(`版本对比-${older.label}-到-${newer.label}.md`, new Blob([content], { type: "text/markdown;charset=utf-8" }));
            }}><Download className="size-3.5" />下载对比结果</Button>
            <div className="flex overflow-hidden rounded-lg border"><button type="button" onClick={() => setMode("unified")} className={cn("px-2.5 py-1 text-[11px] font-semibold", mode === "unified" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>只看变化</button><button type="button" onClick={() => setMode("side")} className={cn("px-2.5 py-1 text-[11px] font-semibold", mode === "side" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>完整对照</button></div>
            <Button variant="ghost" size="sm" className="size-8 p-0" onClick={onClose} aria-label="关闭"><X className="size-4" /></Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <select value={olderId} onChange={(event) => { setOlderId(event.target.value); setPairIndex(0); }} className="max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" aria-label="旧版本">
            {versions.map((version) => <option key={version.id} value={version.id}>{version.label}{version.candidateTitle ? ` · ${version.candidateTitle}` : ""}</option>)}
          </select>
          {rollbackArm === "old" && older
            ? <Button size="sm" className="h-6 border-rose-300 bg-rose-50 px-2 text-[11px] text-rose-700 hover:bg-rose-100" onClick={() => { onRollback(older.id); onClose(); }}>确认回滚到 {older.label}？</Button>
            : rollbackable(older) && <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => armRollback("old")}><RotateCcw className="size-3" />回滚到旧版</Button>}
          <span className="text-slate-400">→</span>
          <select value={newerId} onChange={(event) => { setNewerId(event.target.value); setPairIndex(0); }} className="max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" aria-label="新版本">
            {versions.map((version) => <option key={version.id} value={version.id}>{version.label}{version.candidateTitle ? ` · ${version.candidateTitle}` : ""}</option>)}
          </select>
          {rollbackArm === "new" && newer
            ? <Button size="sm" className="h-6 border-rose-300 bg-rose-50 px-2 text-[11px] text-rose-700 hover:bg-rose-100" onClick={() => { onRollback(newer.id); onClose(); }}>确认回滚到 {newer.label}？</Button>
            : rollbackable(newer) && <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => armRollback("new")}><RotateCcw className="size-3" />回滚到新版</Button>}
          <span className="text-slate-400">{mode === "unified" ? "默认仅展示变化及少量上下文；未变化的大段内容已折叠" : "完整对照：左右分别展示真实全文，不插入任何对齐占位；绿色为新增、红色为删除"} · {diff.added} 行新增 / {diff.deleted} 行删除{diff.truncated && " · 内容过长，已降级为整段对照"}</span>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-[240px_1fr]">
        <div className="max-h-32 overflow-auto border-b p-2 md:max-h-none md:border-b-0 md:border-r">
          {pairs.map((item, index) => <button key={item.label} onClick={() => setPairIndex(index)} className={cn("mb-1 w-full rounded-lg px-3 py-2 text-left text-xs", index === pairIndex ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-50")}>{item.label}<div className="text-[10px] font-normal text-slate-400">{item.left === undefined ? "仅新版本有" : item.right === undefined ? "仅旧版本有" : "两版本均有"}</div></button>)}
        </div>
        <div className="min-h-0 overflow-auto bg-slate-50">
          {mode === "unified" ? <div className="p-3 font-mono text-[11px] leading-5">{diff.added === 0 && diff.deleted === 0 ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">两个版本内容一致，没有可展示的差异。</div> : compactDiff.map((line, index) => line.type === "skip" ? <div key={index} className="my-1 rounded bg-slate-100 px-2 py-1 text-center text-[10px] text-slate-400">… 省略 {line.count} 行未变化内容 …</div> : <div key={index} className={cn("whitespace-pre-wrap rounded px-2", line.type === "add" ? "bg-emerald-50 text-emerald-800" : line.type === "del" ? "bg-rose-50 text-rose-700" : "text-slate-400")}>{line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}{line.text}</div>)}</div>
          : pairs.length === 0 ? <div className="p-6 text-center text-xs text-slate-400">这两个版本没有可对比的成果物。</div>
          : <div className="font-mono text-[11px] leading-5">
              <div className="sticky top-0 z-10 grid grid-cols-2 divide-x border-b bg-white">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400">{older?.label}（旧版真实全文）</div>
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400">{newer?.label}（新版真实全文）</div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-100">
                <div className="min-w-0 py-1">
                  {fullSides.left.map((line, index) => <div key={index} className={cn("whitespace-pre-wrap px-3", fullLineClass(line.kind))}>{line.text || " "}</div>)}
                </div>
                <div className="min-w-0 py-1">
                  {fullSides.right.map((line, index) => <div key={index} className={cn("whitespace-pre-wrap px-3", fullLineClass(line.kind))}>{line.text || " "}</div>)}
                </div>
              </div>
            </div>}
        </div>
      </div>
    </div>
  </div>;
}

export function ProjectOutputsPanel({ runtime }: { runtime: ProjectRuntime }) {
  const { project } = runtime;
  const champion = project.searchChampion;
  const artifacts = project.outputArtifacts;
  const downloadOne = async (artifact: DownloadableArtifact) => {
    try {
      if (artifact.kind === "primary" || artifact.frozenArtifact) {
        if (artifact.kind === "primary" && !artifact.accepted) throw new Error("此成果尚未通过验收，请先完成验证。");
        const blob = await readFrozenArtifact(artifact.frozenArtifact, artifact.content);
        downloadBlob(artifact.frozenArtifact!.name, blob);
      } else {
        if (!artifact.kind) throw new Error("这份历史记录没有实际文件验证信息。可查看内容或对照差异，请重新验收后下载原格式文件。");
        downloadBlob(artifact.name, new Blob([artifact.content], { type: artifact.mimeType || "text/plain;charset=utf-8" }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败，请重试。");
    }
  };
  const acceptedPrimary = artifacts.filter((artifact) => artifact.kind === "primary" && artifact.accepted).length;
  const artifactGate = champion?.artifactAcceptance;
  const [preview, setPreview] = useState<{ title: string; artifacts: Array<{ id: string; name: string; content: string }>; index: number } | null>(null);
  const [rollbackArm, setRollbackArm] = useState<string | null>(null);
  const [diffPair, setDiffPair] = useState<{ olderId: string; newerId: string } | null>(null);
  // 对比候选把「原文（进化前）」作为置顶伪版本：任意版本都能与原文直接对比。
  const compareVersions = useMemo<EvolvedVersion[]>(() => {
    const sourceOriginal: EvolvedVersion = {
      id: "__source__",
      label: "原文（进化前）",
      createdAt: project.sourceArtifacts[0]?.createdAt ?? project.updatedAt,
      source: "manual",
      summary: "进化对象初始原文，作为版本对比的基准。",
      artifacts: project.sourceArtifacts.filter((artifact) => artifact.role === "target").map((artifact, index) => ({
        id: `src-orig-${index}`,
        name: artifact.name,
        sourceArtifactId: artifact.id,
        content: artifact.textContent || artifact.textExcerpt || "",
      })),
    };
    return [sourceOriginal, ...project.versions];
  }, [project.sourceArtifacts, project.updatedAt, project.versions]);
  // 一键开对比：默认与"上一个版本"比（最早的版本则与原文比），弹层内仍可任意切换两侧。
  const openCompareAt = (versionId: string) => {
    const index = project.versions.findIndex((version) => version.id === versionId);
    const olderId = index > 0 ? project.versions[index - 1]!.id : "__source__";
    setDiffPair({ olderId, newerId: versionId });
  };
  // 「对比当前与原文」直达：优先当前版本（需仍存在），没有则取最新版本。
  const currentCompareId = project.versions.some((version) => version.id === project.currentVersionId)
    ? project.currentVersionId
    : project.versions[project.versions.length - 1]?.id;
  const armRollback = (versionId: string) => {
    setRollbackArm(versionId);
    window.setTimeout(() => setRollbackArm((current) => (current === versionId ? null : current)), 4000);
  };
  const downloadZip = async () => {
    if (!champion) return;
    try {
      const blob = await buildDeliverableZip(project);
      downloadBlob(`${project.name.replace(/\s+/g, "-")}-${champion.versionLabel}-artifacts.zip`, blob);
    } catch (error) { toast.error(error instanceof Error ? error.message : "成果包下载失败"); }
  };
  const previewArtifact = preview?.artifacts[preview.index];
  return <Card className="border-emerald-100 bg-gradient-to-br from-white to-emerald-50/20 soft-shadow">
    <CardHeader className="border-b pb-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div><div className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><PackageCheck className="size-4" />Evolution Outputs</div><CardTitle className="mt-1 text-xl">进化成果物与版本</CardTitle><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">正式成果只冻结 Hidden Validation + Gate F · Artifact Ready 实际验收过的同一 Candidate Artifact Snapshot。成果中心不会在下载时重新生成另一份内容，从而保证“被测试对象 = 最终交付对象”。版本历史仍用于回滚与差异对比。</p></div>
        <div className="flex flex-wrap gap-2"><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{artifacts.length} files</Badge><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{project.versions.length} 个版本</Badge>{acceptedPrimary>0&&<Badge className="border-sky-200 bg-sky-50 text-sky-700">Accepted Primary {acceptedPrimary}</Badge>}{artifactGate&&<Badge className={artifactGate.status === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}>Gate F · {artifactGate.status} · {artifactGate.overallScore}</Badge>}{champion&&<Badge className="border-amber-200 bg-amber-50 text-amber-700"><Trophy className="mr-1 size-3" />{champion.versionLabel}</Badge>}</div>
      </div>
    </CardHeader>
    <CardContent className="pt-5">
      {!!project.archivedOutputs?.length && <details className="mb-5 rounded-xl border bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold">历史目标成果 · {project.archivedOutputs.length} 份</summary><p className="mt-2 text-xs text-slate-600">目标或材料调整前的成果保留在这里，不参与当前目标验收。下载仍校验原始冻结文件。</p><div className="mt-3 space-y-2">{project.archivedOutputs.map((artifact, index) => <div key={`${artifact.id}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-white p-3"><div className="min-w-0"><div className="truncate text-sm">{artifact.name}</div><div className="text-xs text-slate-500">{artifact.versionLabel} · {artifact.createdAt}</div></div><Button variant="secondary" size="sm" onClick={() => void downloadOne(artifact)}>下载</Button></div>)}</div></details>}

      {champion ? <>
        <div className="flex flex-wrap gap-2"><Button onClick={() => void runtime.materializeOutputs()} disabled={artifactGate?.status !== "passed"}><PackageCheck className="size-4" />{artifacts.length ? "重新冻结已验收成果" : "冻结 Gate F 已验收成果"}</Button><Button variant="secondary" disabled={!artifacts.length} onClick={() => void downloadZip()}><Download className="size-4" />下载完整 ZIP</Button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {artifacts.map((artifact)=><div key={artifact.id} className="group rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-sm">
            <div className="flex items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-50 text-indigo-600">{iconByKind[artifact.kind]}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-slate-900">{artifact.name}</div><div className="mt-1 flex gap-1"><Badge>{artifact.kind}</Badge>{artifact.accepted&&<Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Accepted</Badge>}{artifact.isChampion&&<Badge className="border-amber-200 bg-amber-50 text-amber-700">Champion</Badge>}</div></div></div>
            <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-500">{artifact.description}</p>
            {artifact.frozenArtifact && <details className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-2"><summary className="cursor-pointer text-xs font-semibold text-emerald-800">实际文件验证记录</summary><ul className="mt-2 space-y-1 text-xs leading-5 text-slate-700">{artifact.frozenArtifact.checks.map((check) => <li key={check}>{check}</li>)}</ul>{artifact.frozenArtifact.limitations.map((limit) => <p key={limit} className="mt-2 text-xs leading-5 text-amber-800">{limit}</p>)}<p className="mt-2 break-all font-mono text-[10px] text-slate-500">SHA-256: {artifact.frozenArtifact.sha256}</p><p className="mt-1 text-xs text-slate-600">冻结时间：{new Date(artifact.frozenArtifact.verifiedAt).toLocaleString("zh-CN")}</p></details>}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400">{artifact.versionLabel} · Round {artifact.round} · {(artifact.content.length/1024).toFixed(1)} KB</span>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setPreview({ title: "最佳版本成果包", artifacts, index: artifacts.findIndex((item) => item.id === artifact.id) })}><Eye className="size-3.5" />查看</Button>
                <Button size="sm" variant="ghost" onClick={() => void downloadOne(artifact)}><Download className="size-3.5" />下载</Button>
              </div>
            </div>
          </div>)}
        </div>
      </> : <div className="rounded-2xl border border-dashed bg-slate-50 px-5 py-6 text-center"><div className="font-semibold text-slate-700">最佳版本成果包还没生成</div><p className="mt-1 text-xs text-slate-400">注册 Search Champion 后可物化 Patch Bundle / Scorecard / Lineage 等完整交付件；下方的版本历史不依赖 Champion，每轮盲测后即可查看进化成果。</p></div>}

      <div className="mt-6 border-t pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><History className="size-4 text-indigo-600" />版本历史与回滚</div>
          {currentCompareId && <Button size="sm" variant="secondary" onClick={() => setDiffPair({ olderId: "__source__", newerId: currentCompareId })}><GitCompareArrows className="size-3.5" />对比当前与原文</Button>}
        </div>
        <p className="mt-1 text-xs text-slate-400">每个版本保存该轮"进化后成果物"全文——原文按当轮累计改动逐节套用后的完整版本，与原文同骨架、只改该改的章节。查看可核对进化结果；回滚会把所选版本内容固化为新的进化对象，并自动快照回滚前状态，旧评测结论作废、需重跑流程。</p>
        {project.versions.length === 0 ? <div className="mt-3 rounded-2xl border border-dashed bg-slate-50 px-5 py-6 text-center text-xs text-slate-400">还没有版本：完成一轮 Hidden Validation 后，进化后的成果物会自动冻结在这里。</div> : <div className="mt-3 space-y-2">{project.versions.slice().reverse().map((version) => {
          const isCurrent = project.currentVersionId === version.id;
          return <div key={version.id} className={cn("rounded-xl border bg-white p-3", isCurrent && "border-emerald-300 ring-1 ring-emerald-200")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-800">{version.label}</span>
              {isCurrent && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">当前版本</Badge>}
              {version.releasedAt && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700"><Rocket className="mr-1 size-3" />已发布 {new Date(version.releasedAt).toLocaleDateString("zh-CN")}</Badge>}
              <Badge className="border-slate-200 bg-slate-100 text-slate-500">{sourceLabel[version.source] ?? version.source}</Badge>
              {version.candidateTitle && <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{version.candidateTitle}</Badge>}
              {version.scores && <span className="text-[10px] text-slate-400">准确 {version.scores.accuracy}% · 完成 {version.scores.completeness}%</span>}
              <span className="ml-auto text-[10px] text-slate-400">{new Date(version.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">{version.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={version.artifacts.length === 0} onClick={() => setPreview({ title: `${version.label} · 进化成果物`, artifacts: version.artifacts, index: 0 })}><Eye className="size-3.5" />查看成果物</Button>
              {version.source !== "rollback-snapshot" && version.artifacts.length > 0 && (rollbackArm === version.id
                ? <Button size="sm" className="border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={() => { setRollbackArm(null); runtime.rollbackToVersion(version.id); }}>确认回滚？旧结论将作废</Button>
                : <Button size="sm" variant="ghost" onClick={() => armRollback(version.id)}><RotateCcw className="size-3.5" />回滚到此版本</Button>)}
              <Button size="sm" variant="ghost" onClick={() => openCompareAt(version.id)}><GitCompareArrows className="size-3.5" />版本对比</Button>
            </div>
          </div>;
        })}</div>}
      </div>

      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPreview(null)}>
        <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div><div className="text-sm font-bold">{preview.title}</div><div className="text-xs text-slate-400">共 {preview.artifacts.length} 个文件 · 左侧切换查看全文 · 点击蒙层或右上角关闭</div></div>
            <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => setPreview(null)} aria-label="关闭"><X className="size-4" /></Button>
          </div>
          <div className="grid min-h-0 flex-1 md:grid-cols-[240px_1fr]">
            <div className="max-h-36 overflow-auto border-b p-2 md:max-h-none md:border-b-0 md:border-r">
              {preview.artifacts.map((artifact, index) => <button key={artifact.id} onClick={() => setPreview({ ...preview, index })} className={cn("mb-1 w-full rounded-lg px-3 py-2 text-left text-xs", index === preview.index ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-50")}>{artifact.name}<div className="text-[10px] font-normal text-slate-400">{(artifact.content.length / 1024).toFixed(1)} KB</div></button>)}
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2"><span className="truncate text-xs font-semibold text-slate-600">{previewArtifact?.name}</span>{previewArtifact && <Button size="sm" variant="secondary" onClick={() => void downloadOne(previewArtifact)}><Download className="size-3.5" />下载该文件</Button>}</div>
              <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
                {previewArtifact ? splitMermaidSegments(previewArtifact.content).map((segment, index) => segment.type === "mermaid"
                  ? <MermaidBlock key={index} code={segment.value} className="mb-2" />
                  : <pre key={index} className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-700">{segment.value}</pre>)
                : <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-700">（空文件）</pre>}
              </div>
            </div>
          </div>
        </div>
      </div>}

      {diffPair && <VersionDiffModal versions={compareVersions} initialOlderId={diffPair.olderId} initialNewerId={diffPair.newerId} onRollback={(versionId) => runtime.rollbackToVersion(versionId)} onClose={() => setDiffPair(null)} />}
    </CardContent>
  </Card>;
}
