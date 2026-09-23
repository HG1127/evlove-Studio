import {RuntimePerformanceCard} from "./runtime-performance-card";
import {WorkflowJourney} from "./workflow-journey";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  LockKeyhole,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getAiProviderStatus } from "../ai/service";
import { auditKindMeta, listAiAuditEvents } from "../ai/audit-log";
import {
  getAiRoutingPolicy,
  listProviderConnections,
  resolveOperationConnection,
  resolveOperationConnections,
  saveAiRoutingPolicy,
  OPERATION_META,
} from "../ai/providers/registry";
import type { ProjectRuntime } from "../runtime/use-project-runtime";
import { getAutoGateFlag, setAutoGateFlag } from "../runtime/run-manager";
import {
  deriveNextWorkflowAction,
  deriveWorkflowGates,
  deriveWorkflowSteps,
  type WorkflowNextAction,
  type WorkflowStepState,
  workflowRequiresOnlineRelease,
} from "../runtime/workflow-engine";

const phaseMeta = [
  { id: 1, label: "Contract 与基线", range: "01–03" },
  { id: 2, label: "真实运行与 Trace", range: "04–05" },
  { id: 3, label: "评测与问题", range: "06–08" },
  { id: 4, label: "根因与计划", range: "09–10" },
  { id: 5, label: "Candidate-in-the-loop", range: "11–15" },
  { id: 6, label: "Artifact Ready", range: "16–18" },
  { id: 7, label: "线上验证（按需）", range: "19–21" },
  { id: 8, label: "经验与下一轮", range: "22–23" },
] as const;

function stateClass(state: WorkflowStepState) {
  if (state === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (state === "skipped") return "border-slate-200 bg-slate-50 text-slate-400";
  if (state === "running") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (state === "ready") return "border-sky-200 bg-sky-50 text-sky-700";
  if (state === "blocked") return "border-rose-200 bg-rose-50 text-rose-600";
  return "border-slate-200 bg-slate-50 text-slate-400";
}

function stateIcon(state: WorkflowStepState) {
  if (state === "completed") return <Check className="size-3.5" />;
  if (state === "skipped") return <CircleDashed className="size-3.5" />;
  if (state === "running") return <Activity className="size-3.5 animate-pulse" />;
  if (state === "blocked") return <LockKeyhole className="size-3.5" />;
  return <CircleDashed className="size-3.5" />;
}

async function executeWorkflowAction(runtime: ProjectRuntime, action: WorkflowNextAction) {
  if (action.kind === "completed") return;
  if (action.kind === "human-gate") {
    if (action.id === "select-problem") {
      if (!action.problemId) throw new Error("没有可确认的目标问题");
      runtime.selectProblem(action.problemId);
      return;
    }
    if (!action.gateId) throw new Error("Gate 配置缺失");
    runtime.approveGate(action.gateId, `由 本轮执行记录 Console 确认：${action.label}`);
    return;
  }
  if (action.kind === "release") {
    if (!action.releaseAction) throw new Error("Release Action 配置缺失");
    await runtime.releaseAction(action.releaseAction);
    return;
  }
  switch (action.id) {
    case "rubric": await runtime.compileAcceptanceRubric(); break;
    case "eval-suite": await runtime.generateEvalSuite(); break;
    case "baseline": await runtime.executeBaseline(); break;
    case "problems": await runtime.analyzeProblems(); break;
    case "diagnosis": await runtime.diagnose(); break;
    case "plan":
    case "replan": await runtime.generatePlan(); break;
    case "experiment": await runtime.executeExperiment(); break;
    case "validation": await runtime.executeValidation(); break;
    case "materialize": await runtime.materializeOutputs(); break;
    case "distill": await runtime.distill(); break;
    case "next-queue": await runtime.generateNextQueue(); break;
    default: throw new Error(`尚未实现工作流动作：${action.id}`);
  }
}

export function EvolutionRunConsole({ runtime }: { runtime: ProjectRuntime }) {
  const [expanded, setExpanded] = useState(false);
  // 「继续到下一确认点」开关跨界面切换 / 刷新保留：重新进入后自动链从中断处继续。
  const [autoUntilGate, setAutoUntilGateState] = useState(() => getAutoGateFlag(runtime.project.id));
  const setAutoUntilGate = useCallback((enabled: boolean) => {
    setAutoGateFlag(runtime.project.id, enabled);
    setAutoUntilGateState(enabled);
  }, [runtime.project.id]);
  const lastAutoAction = useRef<string | null>(null);
  const steps = useMemo(() => deriveWorkflowSteps(runtime.project), [runtime.project]);
  const gates = useMemo(() => deriveWorkflowGates(runtime.project), [runtime.project]);
  const nextAction = useMemo(() => deriveNextWorkflowAction(runtime.project), [runtime.project]);
  const onlineRelease = workflowRequiresOnlineRelease(runtime.project);
  const completed = steps.filter((item) => item.state === "completed").length;
  const skipped = steps.filter((item) => item.state === "skipped").length;
  const resolved = completed + skipped;
  const progress = Math.round((resolved / steps.length) * 100);
  // 路由 / 连接变化时刷新「本步模型」选择器与状态徽标。
  const [routeTick, setRouteTick] = useState(0);
  useEffect(() => {
    const refresh = () => setRouteTick((value) => value + 1);
    window.addEventListener("evolve-ai-routing-changed", refresh);
    window.addEventListener("evolve-ai-connections-changed", refresh);
    window.addEventListener("evolve-ai-audit-changed", refresh);
    return () => {
      window.removeEventListener("evolve-ai-routing-changed", refresh);
      window.removeEventListener("evolve-ai-connections-changed", refresh);
      window.removeEventListener("evolve-ai-audit-changed", refresh);
    };
  }, []);
  const provider = useMemo(
    () => (nextAction.operation ? getAiProviderStatus(nextAction.operation) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextAction.operation, routeTick],
  );
  // 每个节点执行前可就地换模型：选项 = 已启用连接的「测试通过优先」模型清单。
  const routeOptions = useMemo(() => {
    void routeTick;
    if (!nextAction.operation) return [];
    return listProviderConnections()
      .filter((item) => item.enabled && item.apiKey.trim())
      .flatMap((connection) => {
        const tested = (connection.testedModels ?? []).filter(Boolean);
        const models = [...new Set([...tested, ...connection.models.filter(Boolean)])];
        return models.map((model) => ({
          key: `${connection.id}::${model}`,
          label: `${connection.label} · ${model}`,
          connectionLabel: connection.label,
          tested: tested.includes(model),
          connectionId: connection.id,
          model,
        }));
      });
  }, [nextAction.operation, routeTick]);
  // 按连接分组展示：跨连接的平铺长列表扫读困难，分组后组名即连接、组内测通的带 ✓ 排前。
  const routeGroups = useMemo(() => {
    const groups: Array<{ connectionId: string; connectionLabel: string; options: typeof routeOptions }> = [];
    for (const option of routeOptions) {
      const group = groups.find((item) => item.connectionId === option.connectionId);
      if (group) group.options.push(option);
      else groups.push({ connectionId: option.connectionId, connectionLabel: option.connectionLabel, options: [option] });
    }
    return groups;
  }, [routeOptions]);
  // 最近的自动切换 / 降级留痕：跑不通换了谁、为什么换，执行台就地可见。
  const recentSwitches = useMemo(() => {
    void routeTick;
    return listAiAuditEvents().filter((event) => event.kind !== "manual-check").slice(0, 2);
  }, [routeTick]);
  // 本步真实的自动切换顺序（首选模型 → 同连接测通 → 其他连接）：把「跑不通自动切换」可视化。
  const switchChain = useMemo(() => {
    void routeTick;
    return nextAction.operation ? resolveOperationConnections(nextAction.operation).slice(0, 4) : [];
  }, [nextAction.operation, routeTick]);
  const currentRoute = useMemo(
    () => (nextAction.operation ? resolveOperationConnection(nextAction.operation) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextAction.operation, routeTick],
  );
  const routeValue = currentRoute ? `${currentRoute.connection.id}::${currentRoute.model}` : "";
  const applyNodeModel = (key: string) => {
    const option = routeOptions.find((item) => item.key === key);
    if (!option || !nextAction.operation) return;
    const policy = getAiRoutingPolicy();
    const fallbackConnectionIds = listProviderConnections()
      .filter((item) => item.enabled && item.apiKey.trim() && item.id !== option.connectionId)
      .map((item) => item.id);
    saveAiRoutingPolicy({
      ...policy,
      operationRoutes: {
        ...policy.operationRoutes,
        [nextAction.operation]: { connectionId: option.connectionId, model: option.model, fallbackConnectionIds },
      },
    });
  };

  useEffect(() => {
    if (!autoUntilGate || runtime.status.busy) return;
    const action = deriveNextWorkflowAction(runtime.project);
    if (action.kind !== "machine") {
      lastAutoAction.current = null;
      const timer=window.setTimeout(()=>setAutoUntilGate(false),0);
      return ()=>window.clearTimeout(timer);
    }
    const signature = `${action.id}:${runtime.project.updatedAt}`;
    if (lastAutoAction.current === signature) return;
    lastAutoAction.current = signature;
    void executeWorkflowAction(runtime, action).catch(() => setAutoUntilGate(false));
  }, [autoUntilGate, runtime, runtime.project.updatedAt, runtime.status.busy, setAutoUntilGate]);

  const runNext = async () => {
    await executeWorkflowAction(runtime, deriveNextWorkflowAction(runtime.project));
  };

  return (
    <Card className="overflow-hidden border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50/30 soft-shadow">
      <CardContent className="p-0">
        <div className="flex flex-col gap-4 border-b bg-white/80 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm"><Workflow className="size-4" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-950">Evolution Runtime</h2><Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">四段主链路 · 按依赖推进</Badge></div>
              <p className="mt-1 text-xs leading-5 text-slate-500">主链路完成后即可领取成果。线上发布是按需执行的独立环节；内部节点仅供排查。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起内部节点" : "查看内部节点与发布流程"}</Button>
            <Button variant="secondary" size="sm" disabled={runtime.status.busy || nextAction.kind !== "machine"} onClick={() => { lastAutoAction.current = null; setAutoUntilGate(true); }}>
              <Sparkles className="size-3.5" />自动运行到下个 Gate
            </Button>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
            <div>
              <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-700">本轮闭环进度</span><span className="text-slate-400">{completed} 完成{skipped ? ` · ${skipped} 不适用` : ""} / {steps.length} · {progress}%</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
              <div className="flex items-center justify-between gap-3"><span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">下一步</span>{nextAction.kind === "human-gate" ? <Badge className="border-amber-200 bg-amber-50 text-amber-700">需要确认</Badge> : nextAction.kind === "release" ? <Badge className="border-rose-200 bg-rose-50 text-rose-700">真实流量动作</Badge> : <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">可执行</Badge>}</div>
              <div className="mt-1 font-semibold text-slate-900">{nextAction.label}</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">{nextAction.description}</p>
              {provider && <div className="mt-2 flex flex-wrap gap-1.5"><Badge className="border-slate-200 bg-white text-slate-600"><Bot className="mr-1 size-3" />{provider.provider}</Badge><Badge className="border-slate-200 bg-white text-slate-600">{provider.model}</Badge></div>}
              {nextAction.operation && routeOptions.length > 0 && (
                <label className="mt-2 block">
                  <span className="text-[10px] font-semibold text-slate-500">本步使用模型 · 跑不通时按顺序自动切换</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none"
                    value={routeValue}
                    disabled={runtime.status.busy}
                    onChange={(event) => applyNodeModel(event.target.value)}
                  >
                    {routeValue && !routeOptions.some((item) => item.key === routeValue) && (
                      <option value={routeValue}>{currentRoute?.connection.label} · {currentRoute?.model}</option>
                    )}
                    {routeGroups.map((group) => (
                      <optgroup key={group.connectionId} label={group.connectionLabel}>
                        {group.options.map((option) => (
                          <option key={option.key} value={option.key}>{option.tested ? "✓ " : ""}{option.model}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {switchChain.length > 1 && (
                    <div
                      className="mt-1 truncate text-[10px] leading-4 text-slate-400"
                      title={`跑不通时按此顺序切换：${switchChain.map((item) => `${item.connection.label} · ${item.model}`).join(" → ")}`}
                    >
                      切换顺序：{switchChain.map((item) => `${item.connection.label} · ${item.model}`).join(" → ")}
                    </div>
                  )}
                </label>
              )}
              {recentSwitches.length > 0 && (
                <div className="mt-2 space-y-1">
                  <span className="text-[10px] font-semibold text-slate-500">最近自动切换留痕</span>
                  {recentSwitches.map((event, index) => (
                    <div key={`${event.at}-${index}`} className="truncate rounded-lg border border-amber-100 bg-amber-50/60 px-2 py-1 text-[10px] leading-4 text-amber-700" title={`${event.operation} · ${event.model}：${event.message}`}>
                      {auditKindMeta(event.kind).label} · {OPERATION_META[event.operation as keyof typeof OPERATION_META]?.label ?? event.operation} · {event.model}：{event.message}
                    </div>
                  ))}
                </div>
              )}
              <Button className="mt-3 w-full" size="sm" disabled={runtime.status.busy || nextAction.kind === "completed"} onClick={() => void runNext()}>
                {nextAction.kind === "release" ? <ShieldCheck className="size-3.5" /> : nextAction.id === "replan" ? <RotateCcw className="size-3.5" /> : <Play className="size-3.5" />}
                {nextAction.label}
              </Button>
            </div>
          </div>

          <div className="mt-5"><WorkflowJourney runtime={runtime}/><RuntimePerformanceCard/></div>
          <p className="mt-3 text-xs leading-5 text-slate-600">系统先构造实际文件，再做小样本筛选；仅优胜版本做完整验证。同一基线与考卷可复用，失败项定向修复。缺少验证环境时暂停，不重复改写。</p>
          {expanded && <>
            <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {phaseMeta.map((phase) => {
                const items = steps.filter((item) => item.phase === phase.id);
                const done = items.filter((item) => item.state === "completed").length;
                const skippedCount = items.filter((item) => item.state === "skipped").length;
                const resolvedCount = done + skippedCount;
                const allSkipped = items.length > 0 && skippedCount === items.length;
                const active = items.some((item) => item.state === "ready" || item.state === "running");
                const blocked = items.some((item) => item.state === "blocked") && resolvedCount < items.length;
                return <div key={phase.id} className={`rounded-2xl border p-3 ${allSkipped ? "border-slate-200 bg-slate-50/70" : resolvedCount === items.length ? "border-emerald-200 bg-emerald-50/70" : active ? "border-indigo-200 bg-indigo-50/60" : blocked ? "border-rose-100 bg-rose-50/40" : "bg-slate-50/70"}`}>
                  <div className="flex items-center justify-between"><span className="text-[10px] font-bold tracking-wider text-slate-400">PHASE {phase.id}</span><span className="text-[10px] text-slate-400">{phase.range}</span></div>
                  <div className="mt-1 text-xs font-semibold text-slate-800">{phase.label}</div><div className="mt-2 text-[10px] text-slate-400">{allSkipped ? "无需执行" : `${done}/${items.length} 完成${skippedCount ? ` · ${skippedCount} 不适用` : ""}`}</div>
                </div>;
              })}
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border bg-white">
              <div className="min-w-[980px] grid grid-cols-6 gap-px bg-slate-100 p-px">
                {steps.map((item) => <div key={item.id} className="bg-white p-3">
                  <div className="flex items-start gap-2"><span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg border ${stateClass(item.state)}`}>{stateIcon(item.state)}</span><div className="min-w-0"><div className="text-[10px] font-bold text-slate-400">STEP {item.id}</div><div className="mt-0.5 text-xs font-semibold text-slate-800">{item.title}</div></div></div>
                  <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-slate-400">{item.detail}</p>
                </div>)}
              </div>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              {gates.map((gate) => <div key={gate.id} className={`rounded-2xl border p-3 ${gate.state === "passed" ? "border-emerald-200 bg-emerald-50/60" : gate.state === "skipped" ? "border-slate-200 bg-slate-50/70" : gate.state === "failed" || gate.state === "blocked" ? "border-rose-200 bg-rose-50/60" : gate.state === "ready" ? "border-amber-200 bg-amber-50/60" : "bg-slate-50"}`}>
                <div className="flex items-center justify-between"><span className="text-[10px] font-bold tracking-wider text-slate-400">GATE {gate.id}</span>{gate.state === "passed" ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : gate.state === "failed" || gate.state === "blocked" ? <TriangleAlert className="size-3.5 text-rose-500" /> : <CircleDashed className="size-3.5 text-slate-400" />}</div>
                <div className="mt-1 text-xs font-semibold text-slate-800">{gate.title}</div><p className="mt-1 text-[10px] leading-4 text-slate-500">{gate.question}</p><p className="mt-2 text-[10px] leading-4 text-slate-400">{gate.evidence}</p>
              </div>)}
            </div>
          </>}

          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-indigo-500" />
            <span>{onlineRelease ? <><b className="text-slate-700">当前项目已启用线上发布路径。</b> Gate F 后会保留明确的 Release Ready → Shadow → Canary → Promote/Rollback 入口；真实流量动作仍需显式授权。</> : <><b className="text-slate-700">当前为离线成果模式。</b> Gate F 后自动冻结成果、沉淀 Lesson 并生成 Next Queue；Shadow / Canary / Promote 标记为“不适用”，不会阻塞闭环。</>}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
