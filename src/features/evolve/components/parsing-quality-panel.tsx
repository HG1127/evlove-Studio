import { TextEvidenceBrowser } from "./text-evidence-browser";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSearch, Loader2, Network, RefreshCcw, ScanSearch, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { EvolveProject } from "../schemas";
import {
  automaticEvidenceKey,
  clearAutomaticEvidenceCache,
  ensureAutomaticEvidence,
  getCachedAutomaticEvidence,
} from "../runtime/automatic-evidence";
import {
  EVIDENCE_JOB_EVENT,
  listEvidenceJobs,
  type EvidenceJobRecord,
} from "../runtime/evidence-job-store";
import { getVisualEvidence, VISUAL_EVIDENCE_EVENT, type VisualEvidenceStore } from "../runtime/visual-evidence";
import { repositoryGoalCoverageForProject } from "../sources/repository-intelligence";
import {sourceParseState} from "../runtime/source-parse-presentation";

function pct(value?: number) { return value === undefined ? "—" : `${Math.round(value * 100)}%`; }
function avg(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

function jobSummary(jobs: EvidenceJobRecord[]) {
  if (!jobs.length) return "";
  const running = jobs.filter((job) => job.status === "queued" || job.status === "running");
  if (running.length) return `正在后台执行：${running.map((job) => job.label).join("、")}`;
  const ready = jobs.filter((job) => job.status === "ready");
  const partial = jobs.filter((job) => job.status === "partial");
  const unavailable = jobs.filter((job) => job.status === "unavailable");
  const failed = jobs.filter((job) => job.status === "failed");
  const pieces = [
    ready.length ? `${ready.length} 项已验证` : "",
    partial.length ? `${partial.length} 项已有部分真实证据` : "",
    unavailable.length ? `${unavailable.length} 项运行环境暂不可用` : "",
    failed.length ? `${failed.length} 项验证失败` : "",
  ].filter(Boolean);
  const latest = [...jobs].reverse().find((job) => job.summary || job.error);
  return `${pieces.join("；")}${latest ? `；${latest.summary ?? latest.error}` : ""}`;
}

function stateForJobs(jobs: EvidenceJobRecord[], fallbackEvidence = false): "available" | "partial" | "missing" | "running" | "unavailable" {
  if (jobs.some((job) => job.status === "queued" || job.status === "running")) return "running";
  if (jobs.some((job) => job.status === "ready")) return "available";
  if (fallbackEvidence || jobs.some((job) => job.status === "partial")) return "partial";
  if (jobs.some((job) => job.status === "unavailable" || job.status === "failed")) return "unavailable";
  return "missing";
}

export function ParsingQualityPanel({
  project,
  onReparse,
  busy = false,
}: {
  project: EvolveProject;
  onReparse?: () => Promise<unknown> | void;
  busy?: boolean;
  onSetTargetConnection?: (next: EvolveProject["targetConnection"]) => void;
}) {
  const [evidence, setEvidence] = useState<VisualEvidenceStore>(() => getVisualEvidence(project.id));
  const [jobs, setJobs] = useState<EvidenceJobRecord[]>([]);
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);
  const evidenceKey = automaticEvidenceKey(project);
  const cachedAutomaticEvidence = getCachedAutomaticEvidence(project);
  const [automaticEvidenceAttempt, setAutomaticEvidenceAttempt] = useState(0);
  const [automaticEvidence, setAutomaticEvidence] = useState<{
    busy: boolean;
    status: "completed" | "partial" | "skipped";
    summary: string;
  }>(() => cachedAutomaticEvidence
    ? { busy: false, status: cachedAutomaticEvidence.status, summary: cachedAutomaticEvidence.summary }
    : { busy: true, status: "skipped", summary: "后台证据任务已交给 Evidence Runtime。" });

  useEffect(() => {
    const refreshVisual = () => setEvidence(getVisualEvidence(project.id));
    window.addEventListener(VISUAL_EVIDENCE_EVENT, refreshVisual);
    return () => window.removeEventListener(VISUAL_EVIDENCE_EVENT, refreshVisual);
  }, [project.id]);

  useEffect(() => {
    let active = true;
    const refreshJobs = () => {
      void listEvidenceJobs(project.id).then((next) => {
        if (active) setJobs(next);
      });
    };
    refreshJobs();
    window.addEventListener(EVIDENCE_JOB_EVENT, refreshJobs);
    return () => {
      active = false;
      window.removeEventListener(EVIDENCE_JOB_EVENT, refreshJobs);
    };
  }, [project.id]);

  useEffect(() => {
    let active = true;
    const snapshot = projectRef.current;
    const cached = automaticEvidenceAttempt === 0 ? getCachedAutomaticEvidence(snapshot) : undefined;
    if (cached) {
      queueMicrotask(() => {
        if (active) setAutomaticEvidence({ busy: false, status: cached.status, summary: cached.summary });
      });
      return () => { active = false; };
    }
    queueMicrotask(() => {
      if (active) setAutomaticEvidence({ busy: true, status: "skipped", summary: "后台正在自动完成 Runner 探测、真实运行、截图与视觉证据。" });
    });
    void ensureAutomaticEvidence(snapshot, { force: automaticEvidenceAttempt > 0 }).then((result) => {
      if (!active) return;
      setEvidence(getVisualEvidence(snapshot.id));
      void listEvidenceJobs(snapshot.id).then((next) => active && setJobs(next));
      setAutomaticEvidence({ busy: false, status: result.status, summary: result.summary });
    }).catch((error) => {
      if (!active) return;
      setAutomaticEvidence({
        busy: false,
        status: "partial",
        summary: `后台增强证据暂未完成：${error instanceof Error ? error.message : String(error)}`,
      });
    });
    return () => { active = false; };
  }, [automaticEvidenceAttempt, evidenceKey]);

  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  const profiles = targets.map((artifact) => ({ artifact, profile: artifact.parsingProfile }));
  const repositoryCoverages = repositoryGoalCoverageForProject(project);
  const repoById = new Map(repositoryCoverages.map((item) => [item.artifact.id, item]));
  const fileIndexCoverage = avg(profiles.map(({ profile }) => profile?.totalEntries ? profile.indexedEntries / profile.totalEntries : profile?.structuralCoverage ?? 0));
  const deepIndexCoverage = repositoryCoverages.length ? avg(repositoryCoverages.map((item) => item.deepIndexCoverage)) : avg(profiles.map(({ profile }) => profile?.deepIndexCoverage ?? profile?.completeness ?? 0));
  const criticalCoverage = repositoryCoverages.length ? avg(repositoryCoverages.map((item) => item.criticalModuleCoverage)) : avg(profiles.map(({ profile }) => profile?.criticalModuleCoverage ?? profile?.structuralCoverage ?? 0));
  const dependencyCoverage = repositoryCoverages.length ? avg(repositoryCoverages.map((item) => item.dependencyCoverage)) : avg(profiles.map(({ profile }) => profile?.dependencyCoverage ?? 1));
  const goalCoverage = repositoryCoverages.length ? avg(repositoryCoverages.map((item) => item.requirementEvidenceCoverage)) : avg(profiles.map(({ profile }) => profile?.completeness ?? 0));
  const semanticCoverage = repositoryCoverages.length ? avg(repositoryCoverages.map((item) => item.semanticCoverage)) : avg(profiles.map(({ profile }) => profile?.completeness ?? 0));
  const limitations = [...new Set(profiles.flatMap((item) => item.profile?.limitations ?? []))].slice(0, 6);
  const recommendations = [...new Set(profiles.flatMap((item) => item.profile?.recommendations ?? []))].slice(0, 5);
  const hasCode = targets.some((artifact) => artifact.artifactKind === "codebase");
  const staticAvailable = hasCode && profiles.some((item) => (item.profile?.indexedSymbols ?? 0) > 0 || (item.profile?.codeFiles ?? 0) > 0);
  const visual = evidence.items.length > 0;
  const formatRoundtrip = targets.every((artifact) => artifact.artifactDescriptor?.capabilities.materialize !== false);
  const canJudgeStatic = staticAvailable || !hasCode;
  const hasParseIssue=targets.some((artifact)=>sourceParseState(artifact)==="failed");
  const hasPartialParse=targets.some((artifact)=>sourceParseState(artifact)==="partial");

  const runtimeJobs = jobs.filter((job) => ["build", "browser-smoke", "e2e"].includes(job.kind));
  const visualJobs = jobs.filter((job) => ["screenshot", "visual-judge"].includes(job.kind));
  const runtimeState = stateForJobs(runtimeJobs);
  const visualState = evidence.judge ? "available" : stateForJobs(visualJobs, visual);
  const runtimeDetail = jobSummary(runtimeJobs) || "项目创建后由后台自动判断是否需要 Build、浏览器 Smoke 或真实交互 E2E。";
  const visualDetail = evidence.judge
    ? `已完成 Visual Judge · ${evidence.items.length} 张真实截图`
    : jobSummary(visualJobs) || (visual ? `已有 ${evidence.items.length} 张真实截图，等待后台视觉评审` : "适用网页成果会自动生成桌面/手机截图并进入 Visual Judge。");

  return <Card className="border-sky-100 bg-sky-50/30"><CardContent className="pt-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileSearch className="size-4 text-sky-600" />材料与验证均已后台化</div>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">上传后系统自动解析材料，并按成果类型自动执行 Runner 探测、Build/Test、浏览器 Smoke、真实交互、双视口截图和 Visual Judge。普通使用无需连接或配置验证器。</p>
      </div>
      <div className="flex flex-wrap gap-2">{hasParseIssue && onReparse && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onReparse()}><RefreshCcw className={`size-3.5 ${busy ? "animate-spin" : ""}`} />修复解析</Button>}</div>
    </div>

    {(automaticEvidence.busy || automaticEvidence.status === "partial") ? <div className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-xs leading-5 ${automaticEvidence.status === "partial" ? "border-amber-100 bg-amber-50/60 text-amber-900" : "border-sky-100 bg-sky-50/60 text-sky-900"}`}>
      {automaticEvidence.busy ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-indigo-600" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />}
      <div className="min-w-0 flex-1"><div className="font-semibold">{automaticEvidence.busy ? "后台正在验证成果" : "后台验证已完成可用部分"}</div><div className="opacity-80">{automaticEvidence.summary}</div></div>
      {!automaticEvidence.busy && <Button size="sm" variant="secondary" onClick={() => { clearAutomaticEvidenceCache(project); setAutomaticEvidenceAttempt((value) => value + 1); }}><RefreshCcw className="size-3.5" />重试后台验证</Button>}
    </div> : hasParseIssue||hasPartialParse ? <div className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-700"><AlertTriangle className="size-3.5" />{hasParseIssue?"部分材料未能解析；原文件已保留，请查看限制并修复。":"材料仅完成部分索引；请查看覆盖率和解析限制。"}</div> : <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-700"><CheckCircle2 className="size-3.5" />材料解析与适用的后台证据任务已完成</div>}

    <details className="mt-3 rounded-2xl border bg-white p-4">
      <summary className="cursor-pointer text-xs font-semibold text-slate-600">查看解析覆盖与证据详情</summary>

      <section className="mt-4 rounded-2xl border bg-white p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800"><ScanSearch className="size-3.5 text-indigo-600" />A. 系统到底读懂了多少？</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Mini label="文件清单索引" value={repositoryCoverages.length ? pct(fileIndexCoverage) : "非工程文件"} hint="ZIP/成果结构是否完整盘点" />
          <Mini label="可解析内容深索引" value={pct(deepIndexCoverage)} hint="可读内容是否进入可检索 Deep Index" />
          <Mini label="关键模块覆盖" value={repositoryCoverages.length ? pct(criticalCoverage) : "不适用"} hint="入口、流程、解析、验证、主要 UI 等关键模块" />
          <Mini label="依赖关系覆盖" value={repositoryCoverages.length ? pct(dependencyCoverage) : "不适用"} hint="内部 import 是否解析到实际文件" />
          <Mini label="用户目标证据覆盖" value={repositoryCoverages.length ? pct(goalCoverage) : "待目标验收"} hint="本轮用户要求是否都有相关实现证据" tone={goalCoverage >= 0.75 ? "green" : goalCoverage >= 0.45 ? "amber" : "slate"} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500"><span>综合语义覆盖 <b className="text-slate-800">{repositoryCoverages.length ? pct(semanticCoverage) : "未评估"}</b></span><span>覆盖率表示索引范围，不代表理解准确度或目标已经达成；真实行为由下方 Evidence Runtime 单独验证。</span></div>
      </section>

      <section className="mt-3 rounded-2xl border bg-white p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800"><Network className="size-3.5 text-indigo-600" />B. 后台真正执行/验证了什么？</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Capability label="静态源码/结构证据" state={canJudgeStatic ? "available" : "missing"} detail={staticAvailable ? "AST / Symbol / Dependency / Relevant Module Retrieval" : "非代码成果按结构/文本证据"} />
          <Capability label="Build / E2E / 真实交互" state={runtimeState} detail={runtimeDetail} />
          <Capability label="视觉 / UIUX 证据" state={visualState} detail={visualDetail} />
          <Capability label="原格式回写 / Roundtrip" state={formatRoundtrip ? "available" : "partial"} detail={formatRoundtrip ? "目标成果具备 Materializer" : "部分成果只能分析，不能高保真回写"} />
        </div>
      </section>

      {targets.map((artifact) => <TextEvidenceBrowser key={artifact.id} artifact={artifact} />)}

      <section className="mt-3 rounded-2xl border bg-white p-4">
        <div className="text-xs font-semibold text-slate-800">C. 当前系统有资格判断到什么层级？</div>
        <div className="mt-3 grid gap-3 text-xs leading-5 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"><div className="flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle2 className="size-3.5" />可以据证据判断</div><ul className="mt-1 text-emerald-800/80"><li>• 文件/模块、Schema/接口与静态流程结构</li><li>• 已完成 Runner 任务对应的 Build / Browser / E2E 行为</li><li>• 已绑定截图版本上的 UI/UX Visual Judge 结论</li></ul></div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3"><div className="flex items-center gap-2 font-semibold text-amber-800"><ShieldQuestion className="size-3.5" />后台环境缺失时保持未验证</div><ul className="mt-1 text-amber-800/80"><li>• Docker 未配置时不把静态代码当作 Build 通过</li><li>• 没有真实视觉模型时只保存截图，不伪造 UI/UX 分数</li><li>• 没有可执行断言时 Browser Smoke 只记 PARTIAL，不冒充完整 E2E</li></ul></div>
        </div>
      </section>

      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {profiles.map(({ artifact, profile }) => {
          const repo = repoById.get(artifact.id);
          return <div key={artifact.id} className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{artifact.name}</div><Badge>{profile?.engineLabel ?? "旧项目/无解析画像"}</Badge></div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 sm:grid-cols-4"><span>文件 {profile?.indexedEntries ?? 0}/{profile?.totalEntries ?? 0}</span><span>深索引 {profile?.deepIndexedEntries ?? profile?.parsedEntries ?? 0}/{profile?.eligibleEntries ?? profile?.parsedEntries ?? 0}</span><span>Symbols {profile?.indexedSymbols ?? 0}</span><span>依赖 {profile?.resolvedInternalImports ?? 0}/{profile?.internalImports ?? 0}</span><span>关键模块 {repo ? `${Math.round(repo.criticalModuleCoverage * 100)}%` : pct(profile?.criticalModuleCoverage)}</span><span>目标证据 {repo ? `${Math.round(repo.requirementEvidenceCoverage * 100)}%` : "—"}</span><span>AI 摘要窗 {profile?.contextWindowChars ? `${Math.round(profile.contextWindowChars / 1000)}k chars` : "—"}</span><span>AST {profile?.codeFiles ? `${profile.codeFiles} files` : "—"}</span></div>
            {repo?.anchors.length ? <><div className="mt-2 flex flex-wrap gap-1">{repo.anchors.slice(0, 6).map((anchor) => <Badge key={anchor.id} className={anchor.coverage >= 0.67 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : anchor.coverage > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-500"}>{anchor.label} {Math.round(anchor.coverage * 100)}%</Badge>)}</div><details className="mt-2 rounded-lg border bg-slate-50 px-3 py-2"><summary className="cursor-pointer text-xs font-semibold text-slate-600">查看“用户目标 → 相关模块”证据映射</summary><div className="mt-2 space-y-2">{repo.anchors.map((anchor) => <div key={anchor.id} className="text-xs leading-4"><b className="text-slate-700">{anchor.label}</b><span className="ml-2 text-slate-400">覆盖 {Math.round(anchor.coverage * 100)}%</span><div className="mt-0.5 break-all text-slate-500">{anchor.evidencePaths.length ? anchor.evidencePaths.join(" · ") : "尚未找到足够强的实现证据"}</div></div>)}</div></details></> : null}
          </div>;
        })}
      </div>
    </details>

    {limitations.length > 0 && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-3.5" />当前证据边界</div><ul className="mt-1 space-y-0.5">{limitations.map((item) => <li key={item}>• {item}</li>)}</ul></div>}
    {recommendations.length > 0 && <div className="mt-2 rounded-xl border bg-white px-3 py-2.5 text-xs leading-5 text-slate-500"><b>下一步建议：</b>{recommendations.join("；")}</div>}
  </CardContent></Card>;
}

function Mini({ label, value, hint, tone = "slate" }: { label: string; value: string; hint: string; tone?: "slate" | "green" | "amber" }) {
  const style = tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-slate-800";
  return <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-400">{label}</div><div className={`mt-1 text-sm font-bold ${style}`}>{value}</div><div className="mt-1 text-[9px] leading-4 text-slate-400">{hint}</div></div>;
}

function Capability({
  label,
  state,
  detail,
}: {
  label: string;
  state: "available" | "partial" | "missing" | "running" | "unavailable";
  detail: string;
}) {
  const cls = state === "available" ? "border-emerald-100 bg-emerald-50/60 text-emerald-800"
    : state === "running" ? "border-sky-100 bg-sky-50/60 text-sky-800"
    : state === "partial" ? "border-amber-100 bg-amber-50/60 text-amber-800"
    : state === "unavailable" ? "border-slate-200 bg-slate-50 text-slate-600"
    : "border-slate-200 bg-slate-50 text-slate-600";
  const status = state === "available" ? "已验证"
    : state === "running" ? "后台验证中"
    : state === "partial" ? "部分证据"
    : state === "unavailable" ? "暂不可用"
    : "待验证";
  return <div className={`rounded-xl border p-3 ${cls}`}><div className="flex items-center justify-between gap-2 text-xs font-semibold"><span>{label}</span><span>{status}</span></div><div className="mt-1 text-xs leading-4 opacity-80">{detail}</div></div>;
}

