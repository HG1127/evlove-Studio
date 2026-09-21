import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  Copy,
  ExternalLink,
  GitBranch,
  KeyRound,
  Layers3,
  Plus,
  PlugZap,
  RefreshCcw,
  Route,
  Save,
  ScanSearch,
  ServerCog,
  ShieldCheck,
  Stethoscope,
  Trash2,
  WandSparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ModelCombobox } from "./model-combobox";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getRunnerStatus } from "../runtime/api";
import { getRunnerGatewayConfig, saveRunnerGatewayConfig, resetRunnerGatewayConfig, isBuiltinRunnerGateway, testRunnerGateway, type RunnerGatewayConfig } from "../runtime/target-runner-config";
import { auditKindMeta, clearAiAuditEvents, countRecentAiAuditEvents, listAiAuditEvents, recordAiAuditEvent, type AiAuditEvent } from "../ai/audit-log";
import {
  getPreset,
  listByokModels,
  normalizeBaseUrl,
  testByokConnection,
  type ResolvedByok,
} from "../ai/providers/byok";
import {
  OPERATION_META,
  SUPPORTED_PROVIDER_PRESETS,
  applyRoutingPreset,
  createProviderConnection,
  deleteProviderConnection,
  getAiRoutingPolicy,
  getOperationRoutingSummary,
  getProviderFallbackModels,
  isPlausibleModelId,
  deleteRoutingPreset,
  listProviderConnections,
  listSavedRoutingPresets,
  noteModelTested,
  pruneConnectionToTested,
  saveAiRoutingPolicy,
  saveRoutingPreset,
  type SavedRoutingPreset,
  upsertProviderConnection,
  type AiRoute,
  type AiRoutingPolicy,
  type ProviderConnection,
} from "../ai/providers/registry";
import type { AiOperation } from "../ai/schemas";
import { getParserGatewayConfig, saveParserGatewayConfig, testParserService, type ParserGatewayConfig, type ParserServiceKind } from "../sources/parser-gateway";

const inputCls = "w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
const PARSER_SERVICES: Array<{kind:ParserServiceKind;label:string;note:string;placeholder:string}> = [
  {kind:"docling",label:"Docling",note:"PDF / DOCX / PPTX / XLSX：结构、布局、表格与统一文档表示。",placeholder:"http://localhost:5001/v1/convert/file"},
  {kind:"unstructured",label:"Unstructured",note:"复杂 PDF、扫描件、Title/Text/Table 分区、OCR/hi_res。",placeholder:"https://api.unstructuredapp.io/general/v0/general"},
  {kind:"tika",label:"Apache Tika",note:"广谱文件类型检测、文本/元数据抽取；适合作为未知格式兜底。",placeholder:"http://localhost:9998"},
  {kind:"custom",label:"Custom Parser",note:"企业自建 Parser Worker / OCR / VLM / 专用格式解析。",placeholder:"https://parser.example.com/parse"},
];

function draftResolved(connection: ProviderConnection): ResolvedByok | null {
  const preset = getPreset(connection.providerId);
  if (!connection.apiKey.trim()) return null;
  const baseUrl = normalizeBaseUrl(connection.baseUrl?.trim() || preset.defaultBaseUrl);
  if (!baseUrl) return null;
  return {
    preset,
    baseUrl,
    config: {
      enabled: true,
      providerId: connection.providerId,
      apiKey: connection.apiKey.trim(),
      baseUrl: connection.baseUrl,
      model: connection.defaultModel || preset.defaultModel,
    },
  };
}

function connectionStatus(connection: ProviderConnection) {
  if (!connection.apiKey.trim()) return { label: "缺少 Key", tone: "amber" } as const;
  if (connection.lastTestStatus === "ok") return { label: "Connected", tone: "green" } as const;
  if ((connection.testedModels?.length ?? 0) > 0) return { label: "部分模型可用", tone: "amber" } as const;
  if (connection.lastTestStatus === "error") return { label: "Connection error", tone: "rose" } as const;
  return { label: "未测试", tone: "slate" } as const;
}

export function SettingsPanel() {
  const [runnerStatus, setRunnerStatus] = useState(() => getRunnerStatus());
  const [connections, setConnections] = useState<ProviderConnection[]>(() => listProviderConnections());
  const [selectedId, setSelectedId] = useState<string | undefined>(() => listProviderConnections()[0]?.id);
  const [routing, setRouting] = useState<AiRoutingPolicy>(() => getAiRoutingPolicy());
  const [busyId, setBusyId] = useState<string>();
  const [batchProgress, setBatchProgress] = useState<{ id: string; done: number; total: number; current: string } | null>(null);
  const [message, setMessage] = useState<string>();
  const [activeTab, setActiveTab] = useState("connections");
  const [parserConfig, setParserConfig] = useState<ParserGatewayConfig>(() => getParserGatewayConfig());
  const [runnerGateway, setRunnerGateway] = useState<RunnerGatewayConfig>(() => getRunnerGatewayConfig());
  const [runnerTest, setRunnerTest] = useState<string>();
  const [runnerTesting, setRunnerTesting] = useState(false);
  const [runnerOk, setRunnerOk] = useState(false);
  useEffect(() => {
    if (activeTab !== "target") return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setRunnerTesting(true);
      const result = await testRunnerGateway(getRunnerGatewayConfig());
      if (!active) return;
      setRunnerTest(result.message);
      setRunnerOk(result.ok);
      setRunnerTesting(false);
    });
    return () => { active = false; };
  }, [activeTab]);
  async function checkRunner(config = runnerGateway) {
    setRunnerTesting(true);
    const result = await testRunnerGateway(config);
    setRunnerTest(result.message);
    setRunnerOk(result.ok);
    if (result.ok) {
      const next = { ...config, enabled: true };
      saveRunnerGatewayConfig(next);
      setRunnerGateway(next);
      setRunnerStatus(getRunnerStatus());
    }
    setRunnerTesting(false);
  }

  useEffect(() => {
    const refresh = () => {
      setConnections(listProviderConnections());
      setRouting(getAiRoutingPolicy());
      setRunnerStatus(getRunnerStatus());
    };
    window.addEventListener("evolve-ai-connections-changed", refresh);
    window.addEventListener("evolve-ai-routing-changed", refresh);
    return () => {
      window.removeEventListener("evolve-ai-connections-changed", refresh);
      window.removeEventListener("evolve-ai-routing-changed", refresh);
    };
  }, []);

  useEffect(() => {
    const nextId = connections.some((item) => item.id === selectedId) ? selectedId : connections[0]?.id;
    if (nextId === selectedId) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) setSelectedId(nextId); });
    return () => { active = false; };
  }, [connections, selectedId]);

  const selected = connections.find((item) => item.id === selectedId);
  const routeSummary = getOperationRoutingSummary();
  const evaluatorWarning = routeSummary.find((item) => item.operation === "evaluate")?.independentEvaluatorWarning;

  const saveConnection = (next: ProviderConnection) => {
    const saved = upsertProviderConnection(next);
    setConnections(listProviderConnections());
    setSelectedId(saved.id);
    setMessage(`${saved.label} 已保存。你可以同步模型、测试连接，并在“模型路由”里指定它负责的环节。`);
  };

  const patchSelected = (patch: Partial<ProviderConnection>) => {
    if (!selected) return;
    const next = { ...selected, ...patch };
    saveConnection(next);
  };

  const addConnection = (providerId = "openai") => {
    const item = createProviderConnection(providerId);
    saveConnection(item);
  };

  const syncModels = async (connection: ProviderConnection) => {
    const resolved = draftResolved(connection);
    if (!resolved) { setMessage("请先填写并保存 API Key。"); return; }
    setBusyId(`${connection.id}:models`);
    try {
      const remote = await listByokModels(resolved);
      const models = [...new Set([...getProviderFallbackModels(connection.providerId), ...remote])];
      const saved = upsertProviderConnection({ ...connection, models, modelsExact: undefined, lastModelSyncAt: new Date().toISOString() });
      setConnections(listProviderConnections());
      setMessage(remote.length
        ? connection.providerId === "opencode"
          ? `OpenCode Zen 未开放 GET /models；已加载 ${remote.length} 个官方模型 ID。请点“测试并筛选模型”，只保留当前 Key 实际可调用的模型。`
          : `已从 ${saved.label} 同步 ${remote.length} 个可用对话模型。`
        : `连接正常，但该服务的模型清单返回为空（部分中转不开放清单接口）。可在「模型名称」里直接输入模型 ID 保存使用，或用「测试」逐个验证。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      setMessage(`模型清单同步未完成：${detail} 当前模型「${connection.defaultModel}」不会被删除，可继续点“测试”验证调用能力。`);
      recordAiAuditEvent({ operation: "同步模型", model: resolved.config.model || connection.defaultModel, kind: "manual-check", message: detail });
    } finally { setBusyId(undefined); }
  };

  const testConnection = async (connection: ProviderConnection) => {
    const resolved = draftResolved(connection);
    if (!resolved) { setMessage("请先填写 API Key / Base URL。"); return; }
    const testedModel = resolved.config.model || connection.defaultModel;
    if (!testedModel.trim()) { setMessage("请先在「模型名称」里输入或选择一个模型再测试：不然不知道要验证哪个模型。"); return; }
    if (!isPlausibleModelId(testedModel)) { setMessage(`模型名「${testedModel.trim()}」像是没输完的片段：请输入完整模型 ID（如 glm-4.7）再测试，否则片段会被误记成可用模型。`); return; }
    setBusyId(`${connection.id}:test`);
    try {
      const { text, latencyMs } = await testByokConnection(resolved);
      noteModelTested(connection, testedModel, text || "ok", latencyMs);
      setConnections(listProviderConnections());
      setMessage(`${connection.label} · ${testedModel} 连接成功 · 往返延迟 ${latencyMs}ms，已记入「测试通过」，可随时一键切回。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      upsertProviderConnection({ ...connection, lastTestAt: new Date().toISOString(), lastTestStatus: "error", lastTestMessage: detail });
      setConnections(listProviderConnections());
      // 填了展示名（如「Muse Spark 1.3 Contributor Free」）而列表里有对应模型 ID 时，直接指路
      const hyphenated = testedModel.toLowerCase().replace(/\s+/g, "-");
      const candidate = connection.models.find((item) => item.toLowerCase() === hyphenated);
      setMessage(`连接失败：${detail}${candidate ? ` 模型列表里有同名模型 ID「${candidate}」：服务一般只认模型 ID、不认展示名，选择它再试。` : ""}`);
      recordAiAuditEvent({ operation: "连接测试", model: resolved.config.model || connection.defaultModel, kind: "manual-check", message: detail });
    } finally { setBusyId(undefined); }
  };

  // 一键批量测试：逐个模型发最小探针请求，只把测试通过的保留进模型列表；
  // 顺序执行避免触发供应商限流，进度实时显示在按钮与提示条上。
  const batchTestAndPrune = async (connection: ProviderConnection) => {
    const resolved = draftResolved(connection);
    if (!resolved) { setMessage("请先填写并保存 API Key。"); return; }
    const candidates = [...new Set(connection.models.filter(Boolean))];
    if (!candidates.length) { setMessage("还没有模型可测：先点「同步模型」，或手动输入模型 ID。"); return; }
    const passed: string[] = [];
    const failed: string[] = [];
    // 每个通过模型的实测延迟：落进连接档案，之后路由排序同等可用优先低延迟。
    const latencyMap: Record<string, number> = {};
    for (const model of candidates) {
      setBatchProgress({ id: connection.id, done: passed.length + failed.length, total: candidates.length, current: model });
      try {
        const { latencyMs } = await testByokConnection({ ...resolved, config: { ...resolved.config, model } });
        passed.push(model);
        latencyMap[model] = latencyMs;
      } catch {
        failed.push(model);
      }
    }
    setBatchProgress(null);
    if (!passed.length) {
      upsertProviderConnection({ ...connection, lastTestAt: new Date().toISOString(), lastTestStatus: "error", lastTestMessage: `批量测试 ${candidates.length} 个模型均未通过` });
      setConnections(listProviderConnections());
      setMessage(`批量测试完成：${candidates.length} 个模型都未通过，已保留原列表；请检查 API Key、Base URL 或供应商额度。`);
      recordAiAuditEvent({ operation: "批量模型筛选", model: connection.defaultModel, kind: "manual-check", message: `${candidates.length} 个模型均未通过` });
      return;
    }
    const saved = pruneConnectionToTested(connection, passed, latencyMap);
    setConnections(listProviderConnections());
    const switched = saved.defaultModel !== connection.defaultModel ? `，默认模型已切换为 ${saved.defaultModel}` : "";
    const removed = failed.slice(0, 4).join("、") + (failed.length > 4 ? ` 等 ${failed.length} 个` : "");
    const fastest = passed.slice().sort((a, b) => (latencyMap[a] ?? Infinity) - (latencyMap[b] ?? Infinity))[0];
    const latencyNote = fastest && latencyMap[fastest] ? `；最快 ${fastest}（${latencyMap[fastest]}ms）` : "";
    setMessage(`批量测试完成：${passed.length}/${candidates.length} 个模型可用，已仅保留可用模型${switched}${latencyNote}；移除不可用 ${failed.length} 个：${removed || "无"}。点「同步模型」可恢复完整列表。`);
    recordAiAuditEvent({ operation: "批量模型筛选", model: saved.defaultModel, kind: "manual-check", message: `通过 ${passed.length} / 移除 ${failed.length}` });
  };

  // 一键体检：逐个测试每个启用连接的默认模型，刷新连接状态与「测通」记录；
  // 顺序执行避免限流，进度显示在按钮上。
  const testAllConnections = async () => {
    const targets = connections.filter((item) => item.enabled && item.apiKey.trim());
    if (!targets.length) { setMessage("还没有可测的连接：先添加并启用连接、填写 API Key。"); return; }
    const ok: string[] = [];
    const bad: string[] = [];
    const latencyByLabel: Record<string, number> = {};
    for (const connection of targets) {
      setBatchProgress({ id: "__all__", done: ok.length + bad.length, total: targets.length, current: connection.label });
      const resolved = draftResolved(connection);
      const model = connection.defaultModel;
      if (!resolved || !isPlausibleModelId(model)) { bad.push(connection.label); continue; }
      try {
        const { text, latencyMs } = await testByokConnection({ ...resolved, config: { ...resolved.config, model } });
        noteModelTested(connection, model, text || "ok", latencyMs);
        ok.push(connection.label);
        latencyByLabel[connection.label] = latencyMs;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "unknown error";
        upsertProviderConnection({ ...connection, lastTestAt: new Date().toISOString(), lastTestStatus: "error", lastTestMessage: detail });
        bad.push(connection.label);
      }
    }
    setBatchProgress(null);
    setConnections(listProviderConnections());
    const latencySummary = ok.length ? `（延迟 ${ok.map((label) => `${label} ${latencyByLabel[label]}ms`).join("，")}）` : "";
    setMessage(`全部连接测试完成：${ok.length} 个通过${latencySummary}${bad.length ? `，${bad.length} 个失败：${bad.join("、")}（失败原因见各连接卡片）` : "，全部可用"}。`);
    if (bad.length) recordAiAuditEvent({ operation: "全部连接测试", model: `${ok.length}/${targets.length} 通过`, kind: "manual-check", message: `失败：${bad.join("、")}` });
  };

  const setOperationRoute = (operation: AiOperation, connectionId: string, model?: string) => {
    const next: AiRoutingPolicy = {
      ...routing,
      operationRoutes: {
        ...routing.operationRoutes,
        [operation]: connectionId
          ? { connectionId, model, fallbackConnectionIds: connections.filter((item) => item.id !== connectionId && item.enabled).map((item) => item.id) }
          : undefined,
      },
    };
    saveAiRoutingPolicy(next);
    setRouting(next);
  };

  const setOperationModel = (operation: AiOperation, model: string) => {
    const route = routing.operationRoutes[operation] ?? routing.defaultRoute;
    if (!route?.connectionId) return;
    setOperationRoute(operation, route.connectionId, model);
  };

  // 一键把某个环节的「连接 + 模型」整套应用到所有环节（含默认路由）：
  // 配好一行后全表复用，不用逐行重复选择。每个环节都写入显式路由，
  // 避免只改 defaultRoute 时个别环节仍停留在旧配置上。
  const applyRouteToAllOperations = (operation: AiOperation) => {
    const route = routing.operationRoutes[operation] ?? routing.defaultRoute;
    if (!route?.connectionId) { setMessage("该环节还没有选择供应商连接，先选连接再一键应用。"); return; }
    const connectionId = route.connectionId;
    const model = route.model ?? connections.find((item) => item.id === connectionId)?.defaultModel;
    const fallbackConnectionIds = connections.filter((item) => item.id !== connectionId && item.enabled).map((item) => item.id);
    const explicitRoute: AiRoute = { connectionId, model, fallbackConnectionIds };
    const next: AiRoutingPolicy = {
      ...routing,
      defaultRoute: explicitRoute,
      operationRoutes: Object.fromEntries((Object.keys(OPERATION_META) as AiOperation[]).map((item) => [item, explicitRoute])),
    };
    saveAiRoutingPolicy(next);
    setRouting(next);
    setMessage(`已把「${OPERATION_META[operation].label}」的连接与模型（${model || "连接默认模型"}）一键应用到全部 ${Object.keys(OPERATION_META).length} 个环节。`);
  };

  // 一键把每个环节的模型换成其连接上「测试通过」的模型（最近测通优先）：
  // 避免某环节挂着没测通的模型、执行时才失败。连接没有测通记录的环节跳过并汇总提示。
  const applyTestedToAllOperations = () => {
    const operationRoutes = { ...routing.operationRoutes };
    let changed = 0;
    let skipped = 0;
    (Object.keys(OPERATION_META) as AiOperation[]).forEach((operation) => {
      const route = routing.operationRoutes[operation] ?? routing.defaultRoute;
      const connection = connections.find((item) => item.id === route?.connectionId) ?? connections.find((item) => item.enabled);
      const tested = (connection?.testedModels ?? []).filter(Boolean);
      if (!connection || !tested.length) { skipped += 1; return; }
      const current = route?.model ?? connection.defaultModel;
      const target = tested.includes(current) ? current : tested[0]!;
      if (route?.connectionId === connection.id && route?.model === target) return;
      operationRoutes[operation] = {
        connectionId: connection.id,
        model: target,
        fallbackConnectionIds: route?.fallbackConnectionIds?.length
          ? route.fallbackConnectionIds
          : connections.filter((item) => item.id !== connection.id && item.enabled).map((item) => item.id),
      };
      changed += 1;
    });
    if (!changed) {
      setMessage(skipped
        ? `没有可切换的测通模型：${skipped} 个环节的连接暂无测通记录，请先「测试」或「测试并筛选模型」。`
        : "所有环节已经在用测试通过的模型，无需改动。");
      return;
    }
    const next = { ...routing, operationRoutes };
    saveAiRoutingPolicy(next);
    setRouting(next);
    setMessage(`已把 ${changed} 个环节切换为测试通过的模型${skipped ? `；${skipped} 个环节因连接暂无测通记录跳过` : ""}。`);
  };

  const applyPreset = (kind: "balanced" | "quality" | "cost" | "independent") => {
    const next = applyRoutingPreset(kind);
    setRouting(next);
    setMessage(`已应用 ${kind} 路由策略。生成、诊断与独立评测可以使用不同模型。`);
  };

  // 一键配置：每个环节自动选「测试通过 > 已同步」里最可靠的可用模型；
  // 保留用户当前已在用的默认模型不动，评测/诊断/发布审查等判分类环节在有多个模型时
  // 自动换用第二个模型，满足“生成者不给自己打分”。先出预览、确认后才真正套用。
  type AutoPlanRow = { operation: AiOperation; label: string; connectionId: string; connectionLabel: string; model: string; fromModel: string; changed: boolean };
  type AutoPlan = { rows: AutoPlanRow[]; judgeIndependent: boolean; usedModels: string[] };
  const [autoPlan, setAutoPlan] = useState<AutoPlan | null>(null);

  const computeAutoPlan = (): AutoPlan | null => {
    const enabled = connections.filter((item) => item.enabled);
    if (!enabled.length) { setMessage("还没有可用的连接：先添加并启用一个供应商连接，同步模型或测通一个模型后再一键配置。"); return null; }
    const pickConnection = (route?: AiRoute) =>
      enabled.find((item) => item.id === route?.connectionId)
      ?? enabled.find((item) => item.id === routing.defaultRoute?.connectionId)
      ?? enabled[0];
    const rows: AutoPlanRow[] = [];
    const usedModels = new Set<string>();
    let judgeIndependent = false;
    (Object.keys(OPERATION_META) as AiOperation[]).forEach((operation) => {
      const existing = routing.operationRoutes[operation];
      const connection = pickConnection(existing);
      // 可用池：测试通过的排前面（最近测通优先），其后是已同步模型。
      const pool = [...new Set([...(connection.testedModels ?? []), ...(connection.models ?? [])].filter(Boolean))];
      if (!pool.length) return;
      // 用户正在用的默认模型若在池里则继续沿用，避免一键配置把已跑通的模型换掉。
      const preferred = pool.includes(connection.defaultModel) ? connection.defaultModel : pool[0]!;
      const isJudge = operation === "evaluate" || operation === "release-review" || operation === "diagnose";
      const model = isJudge && pool.length > 1 ? (pool.find((item) => item !== preferred) ?? preferred) : preferred;
      if (isJudge && model !== preferred) judgeIndependent = true;
      usedModels.add(model);
      // 当前实际生效的模型（与表格显示口径一致：环节指定值，否则连接的默认模型）。
      const bound = connections.find((item) => item.id === (existing?.connectionId ?? routing.defaultRoute?.connectionId));
      const fromModel = existing?.model ?? bound?.defaultModel ?? "";
      rows.push({ operation, label: OPERATION_META[operation].label, connectionId: connection.id, connectionLabel: connection.label, model, fromModel, changed: existing?.connectionId !== connection.id || fromModel !== model });
    });
    if (!rows.length) { setMessage("没有可用的模型：请先在连接配置里点「同步模型」，或测试通过一个模型。"); return null; }
    return { rows, judgeIndependent, usedModels: [...usedModels] };
  };

  const openAutoPlan = () => setAutoPlan(computeAutoPlan());

  const applyAutoPlan = () => {
    if (!autoPlan) return;
    const next: AiRoutingPolicy = { ...routing, operationRoutes: {} };
    autoPlan.rows.forEach((row) => {
      next.operationRoutes[row.operation] = {
        connectionId: row.connectionId,
        model: row.model,
        fallbackConnectionIds: connections.filter((item) => item.id !== row.connectionId && item.enabled).map((item) => item.id),
      };
    });
    saveAiRoutingPolicy(next);
    setRouting(next);
    const changedCount = autoPlan.rows.filter((row) => row.changed).length;
    setAutoPlan(null);
    const suffix = autoPlan.judgeIndependent
      ? "评测 / 诊断 / 发布审查已自动使用第二个模型，满足独立评测。"
      : "当前连接只有 1 个可用模型：再同步更多模型或添加第二个连接后，评测可以独立于生成。";
    setMessage(`已应用配置：${changedCount} 个环节更新，${autoPlan.rows.length - changedCount} 个保持不变，共使用 ${autoPlan.usedModels.length} 个模型。${suffix}`);
  };

  const savePreset = () => {
    const item = saveRoutingPreset(presetName.trim() || `方案 ${presets.length + 1}`, routing, presetNote);
    setPresetName("");
    setPresetNote("");
    setPresets(listSavedRoutingPresets());
    setMessage(`已保存常用方案「${item.name}」，以后点一下就能整套套用。`);
  };

  // 导出只含「环节 → 连接名称 + 模型」的映射，不含任何 API Key。
  const exportRouting = () => {
    const labelOf = (id?: string) => connections.find((item) => item.id === id)?.label ?? null;
    const mapRoute = (route?: AiRoute) => (route?.connectionId ? { connection: labelOf(route.connectionId), model: route.model ?? null } : null);
    const payload = {
      app: "evolve-studio-routing",
      version: 1,
      exportedAt: new Date().toISOString(),
      requireIndependentEvaluator: routing.requireIndependentEvaluator,
      defaultRoute: mapRoute(routing.defaultRoute),
      operationRoutes: Object.fromEntries((Object.keys(OPERATION_META) as AiOperation[]).map((operation) => [operation, mapRoute(routing.operationRoutes[operation])])),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "evolve-routing.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("已导出路由配置（仅连接名称与模型，不含任何 API Key）。");
  };

  // 导入按“连接名称”匹配到当前环境的连接；名称对不上的环节会跳过并提示。
  const importRouting = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as {
        requireIndependentEvaluator?: boolean;
        defaultRoute?: { connection?: string | null; model?: string | null } | null;
        operationRoutes?: Record<string, { connection?: string | null; model?: string | null } | null>;
      };
      if (!data?.operationRoutes) throw new Error("bad shape");
      const byLabel = new Map(connections.map((item) => [item.label, item]));
      const resolve = (label?: string | null) => (label ? byLabel.get(label) : undefined);
      const next: AiRoutingPolicy = {
        ...routing,
        requireIndependentEvaluator: data.requireIndependentEvaluator ?? routing.requireIndependentEvaluator,
        operationRoutes: {},
        defaultRoute: undefined,
      };
      const defaultHit = resolve(data.defaultRoute?.connection);
      if (defaultHit) next.defaultRoute = { connectionId: defaultHit.id, model: data.defaultRoute?.model ?? undefined, fallbackConnectionIds: connections.filter((item) => item.id !== defaultHit.id && item.enabled).map((item) => item.id) };
      const missed = new Set<string>();
      for (const [operation, route] of Object.entries(data.operationRoutes)) {
        if (!route?.connection) continue;
        const hit = resolve(route.connection);
        if (!hit) { missed.add(route.connection); continue; }
        next.operationRoutes[operation as AiOperation] = { connectionId: hit.id, model: route.model ?? undefined, fallbackConnectionIds: connections.filter((item) => item.id !== hit.id && item.enabled).map((item) => item.id) };
      }
      if (!Object.keys(next.operationRoutes).length && !next.defaultRoute) {
        setMessage(`导入失败：文件里的连接名称（${[...missed].join("、") || "未知"}）在当前环境都不存在。先创建同名连接，或在当前环境重新配置。`);
        return;
      }
      saveAiRoutingPolicy(next);
      setRouting(next);
      setMessage(`已导入 ${Object.keys(next.operationRoutes).length} 个环节的路由${missed.size ? `；连接「${[...missed].join("、")}」未匹配，相关环节已跳过` : ""}。`);
    } catch {
      setMessage("导入失败：文件不是有效的路由配置 JSON。");
    }
  };

  const chosenPreset = selected ? getPreset(selected.providerId) : undefined;
  const chosenStatus = selected ? connectionStatus(selected) : undefined;
  const testedList = selected?.testedModels ?? [];
  const [showTestedNotes, setShowTestedNotes] = useState(false);
  const [presets, setPresets] = useState<SavedRoutingPreset[]>(() => listSavedRoutingPresets());
  const [presetName, setPresetName] = useState("");
  const [presetNote, setPresetNote] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);
  // AI 过程留痕：失败重试/演示兜底事件的时间线，供“为什么这次分数来路存疑”回溯。
  const [auditEvents, setAuditEvents] = useState<AiAuditEvent[]>(() => listAiAuditEvents());
  const [auditExpanded, setAuditExpanded] = useState(false);
  const [auditFilter, setAuditFilter] = useState("");
  const recentAuditCount = countRecentAiAuditEvents(24);
  const auditOptions = useMemo(() => [...new Set(auditEvents.map((event) => event.operation))], [auditEvents]);
  const shownAuditEvents = auditFilter ? auditEvents.filter((event) => event.operation === auditFilter) : auditEvents;

  // 备注输入高频触发，直接保存即可，避免每次击键都刷横幅提示。
  const patchSelectedQuiet = (patch: Partial<ProviderConnection>) => {
    if (!selected) return;
    upsertProviderConnection({ ...selected, ...patch });
    setConnections(listProviderConnections());
  };

  const copyTestedList = async () => {
    if (!testedList.length) return;
    const text = testedList.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 非安全上下文（http 域名）下 clipboard API 不可用时退回隐藏 textarea 复制。
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setMessage(`已复制 ${testedList.length} 个测试通过的模型 ID。`);
  };

  const liveRouteCount = routeSummary.filter((item) => item.live).length;
  const tabItems: TabItem[] = [
    {
      value: "connections",
      label: "连接与模型",
      icon: <KeyRound className="size-4" />,
      badge: connections.length ? <Badge className="ml-0.5 border-indigo-200 bg-indigo-50 text-indigo-700">{connections.length}</Badge> : undefined,
    },
    {
      value: "routing",
      label: "环节路由",
      icon: <Route className="size-4" />,
      badge: routeSummary.length ? (
        <Badge className={cn("ml-0.5", liveRouteCount ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
          {liveRouteCount}/{routeSummary.length} Live
        </Badge>
      ) : undefined,
    },
    { value: "target", label: "解析与 Target", icon: <ServerCog className="size-4" /> },
    {
      value: "monitor",
      label: "运行监控",
      icon: <Activity className="size-4" />,
      badge: recentAuditCount > 0 ? (
        <Badge className={cn("ml-0.5", recentAuditCount >= 3 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
          降级 {recentAuditCount}
        </Badge>
      ) : undefined,
    },
  ];

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="text-xs font-semibold text-indigo-600">AI Runtime & Routing</div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">模型供应商、连接与路由</h1>
        <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">一个 Studio 可以同时连接多个供应商。每个连接单独同步模型；每个进化环节可以指定自己的供应商和模型，让“生成候选”和“独立评测”真正分离。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => applyPreset("balanced")}><WandSparkles className="size-4" />均衡路由</Button>
        <Button variant="secondary" onClick={() => applyPreset("independent")}><ShieldCheck className="size-4" />独立评测</Button>
        <Button onClick={() => addConnection("openai")}><Plus className="size-4" />添加 AI 连接</Button>
      </div>
    </div>

    {message && <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs leading-5 text-indigo-800">{message}</div>}

    <Tabs items={tabItems} value={activeTab} onValueChange={setActiveTab} />


    {activeTab === "connections" && (<>
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Layers3 className="size-5 text-indigo-600" />供应商连接{connections.length > 0 && <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">{connections.length} 个连接</Badge>}{connections.filter((item) => item.enabled).length > 0 && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{connections.filter((item) => item.enabled).length} 个启用</Badge>}<span className="ml-auto"><Button variant="secondary" size="sm" disabled={Boolean(batchProgress) || Boolean(busyId)} title="逐个测试每个启用连接的默认模型，刷新连接状态与测通记录" onClick={() => void testAllConnections()}><Stethoscope className={`size-3.5 ${batchProgress?.id === "__all__" ? "animate-pulse" : ""}`} />{batchProgress?.id === "__all__" ? `测试中 ${Math.min(batchProgress.done + 1, batchProgress.total)}/${batchProgress.total}` : "一键测试全部连接"}</Button></span></CardTitle></CardHeader>
      <CardContent className="space-y-3">
          {connections.length === 0 && <div className="rounded-2xl border border-dashed p-7 text-center text-sm text-slate-400">还没有 AI 连接。添加至少一个供应商，才能启用真实进化。</div>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((connection) => {
            const preset = getPreset(connection.providerId);
            const state = connectionStatus(connection);
            return <button key={connection.id} onClick={() => setSelectedId(connection.id)} className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === connection.id ? "border-indigo-300 bg-indigo-50/50 ring-2 ring-indigo-50" : "hover:border-slate-300"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-900">{connection.label}</div><div className="mt-1 truncate text-xs text-slate-400">{connection.defaultModel || preset.defaultModel}</div></div>
                <Badge className={state.tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : state.tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-700" : ""}>{state.label}</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400"><span>{connection.models.length} models{connection.testedModels?.length ? <b className="ml-1 font-semibold text-emerald-600">· ✓ {connection.testedModels.length} 已测通</b> : null}{connection.modelLatency?.[connection.defaultModel || preset.defaultModel] ? <b className="ml-1 font-semibold text-indigo-600" title="默认模型最近一次实测往返延迟">· ⚡ {connection.modelLatency[connection.defaultModel || preset.defaultModel]}ms</b> : null}</span><span>{connection.enabled ? "Enabled" : "Disabled"}</span></div>
            </button>;
          })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <span className="mr-1 text-xs text-slate-400">快速创建：</span>
            {SUPPORTED_PROVIDER_PRESETS.filter((preset) => ["openai", "anthropic", "gemini", "xai", "deepseek", "openrouter", "opencode"].includes(preset.id)).map((preset) => <Button key={preset.id} variant="ghost" size="sm" onClick={() => addConnection(preset.id)} className="text-xs">+ {preset.name.split("（")[0]}</Button>)}
          </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-5 text-indigo-600" />连接配置</CardTitle></CardHeader>
          <CardContent>
            {!selected || !chosenPreset ? <div className="space-y-3 py-1">
              <div className="rounded-2xl border border-dashed p-5 text-center">
                <div className="text-sm font-semibold text-slate-600">{connections.length ? "选择左侧连接进行配置" : "还没有 AI 连接"}</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">{connections.length ? "点击左侧任意连接：编辑 Key、同步模型、测试连通，并在下方路由里指定它负责的环节。" : "添加一个供应商连接后，即可同步模型、测试连通，并让每个进化环节用上真实模型。"}</p>
                {!connections.length && <Button size="sm" className="mt-3" onClick={() => addConnection("openai")}><Plus className="size-4" />添加第一个连接</Button>}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {[["1", "粘贴 Key 并保存", "支持任意兼容 OpenAI 格式的服务，中转地址填 Base URL。"], ["2", "同步模型 / 测试连接", "模型列表从供应商 API 拉取；测试通过的模型可一键切回。"], ["3", "一键配置路由", "按「测试通过优先」自动分配各环节模型，评测自动换独立模型。"]].map(([step, title, desc]) => (
                  <div key={step} className="rounded-xl border bg-slate-50 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-700"><span className="grid size-5 place-items-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">{step}</span>{title}</div>
                    <p className="mt-1.5 text-[11px] leading-4 text-slate-500">{desc}</p>
                  </div>
                ))}
              </div>
            </div> : <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div><div className="mb-1 text-xs text-slate-400">供应商</div><select className={inputCls} value={selected.providerId} onChange={(e) => {
                  const preset = getPreset(e.target.value);
                  const defaultModel = getProviderFallbackModels(e.target.value)[0] || preset.defaultModel;
                  patchSelected({ providerId: e.target.value, label: preset.name, defaultModel, models: getProviderFallbackModels(e.target.value), baseUrl: undefined, lastTestStatus: undefined, lastTestMessage: undefined });
                }}>{SUPPORTED_PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></div>
                <div><div className="mb-1 text-xs text-slate-400">连接名称</div><input className={inputCls} value={selected.label} onChange={(e) => patchSelected({ label: e.target.value })} /></div>
              </div>
              <div><div className="mb-1 flex items-center justify-between text-xs text-slate-400"><span>API Key</span>{chosenPreset.consoleUrl && <a href={chosenPreset.consoleUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600">申请 Key <ExternalLink className="size-3" /></a>}</div><input type="password" className={inputCls} value={selected.apiKey} autoComplete="off" onChange={(e) => patchSelected({ apiKey: e.target.value, lastTestStatus: undefined })} placeholder="粘贴该供应商 API Key" /></div>
              <div className="grid gap-3 md:grid-cols-2">
                <div><div className="mb-1 text-xs text-slate-400">Base URL</div><input className={inputCls} value={selected.baseUrl ?? ""} onChange={(e) => patchSelected({ baseUrl: e.target.value || undefined })} placeholder={chosenPreset.defaultBaseUrl || "https://.../v1"} /></div>
                <div><div className="mb-1 text-xs text-slate-400">默认模型</div><ModelCombobox className={inputCls} models={[selected.defaultModel, ...selected.models]} tested={selected.testedModels} notes={selected.modelNotes} value={selected.defaultModel} onChange={(model) => patchSelected({ defaultModel: model })} placeholder="搜索或输入模型 ID" /></div>
              </div>
              {!!testedList.length && (
                <div className="space-y-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-700">✓ 测试通过 · 点击一键切回</span>
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" onClick={() => void copyTestedList()} className="rounded-lg px-2 py-1 text-[10px] text-slate-500 hover:bg-white">复制清单</button>
                      <button type="button" onClick={() => setShowTestedNotes((v) => !v)} className="rounded-lg px-2 py-1 text-[10px] text-slate-500 hover:bg-white">{showTestedNotes ? "收起备注" : "加备注"}</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {testedList.map((model) => (
                      <button
                        key={model}
                        type="button"
                        onClick={() => patchSelected({ defaultModel: model })}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${model === selected.defaultModel ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700"}`}
                      >
                        <CheckCircle2 className="size-3" />{model}{selected.modelLatency?.[model] ? <span className="font-mono font-normal text-indigo-500" title="实测往返延迟">⚡{selected.modelLatency[model]}ms</span> : null}{selected.modelNotes?.[model] ? <span className="font-normal text-slate-400">· {selected.modelNotes[model]}</span> : null}
                      </button>
                    ))}
                  </div>
                  {showTestedNotes && (
                    <div className="space-y-1.5 border-t border-emerald-100 pt-2">
                      <div className="text-[10px] text-slate-400">给模型起个备注（如「主力生成」「独立评测」）：下拉列表里会跟随显示，也能直接搜备注。</div>
                      {testedList.map((model) => (
                        <div key={`note-${model}`} className="flex items-center gap-2">
                          <span className="w-44 shrink-0 truncate text-xs text-slate-600">{model}</span>
                          <input
                            className="h-7 min-w-0 flex-1 rounded-lg border bg-white px-2 text-xs outline-none focus:border-emerald-400"
                            value={selected.modelNotes?.[model] ?? ""}
                            onChange={(e) => patchSelectedQuiet({ modelNotes: { ...selected.modelNotes, [model]: e.target.value } })}
                            placeholder="备注（可选）"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-500"><b className="text-slate-700">供应商说明：</b>{chosenPreset.note}<br/>模型列表可以从供应商 API 动态同步，也允许手动输入未出现在列表中的模型 ID。</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => saveConnection(selected)}>保存连接</Button>
                <Button variant="secondary" onClick={() => void syncModels(selected)} disabled={Boolean(batchProgress) || busyId === `${selected.id}:models`}><RefreshCcw className={`size-4 ${busyId === `${selected.id}:models` ? "animate-spin" : ""}`} />同步模型</Button>
                <Button variant="secondary" onClick={() => void testConnection(selected)} disabled={Boolean(batchProgress) || busyId === `${selected.id}:test`}><Bot className="size-4" />测试 {selected.defaultModel}</Button>
                <Button variant="secondary" title="逐个测试全部模型，仅保留测试通过的；同步模型可恢复完整列表" onClick={() => void batchTestAndPrune(selected)} disabled={Boolean(batchProgress) || Boolean(busyId)}><ScanSearch className={`size-4 ${batchProgress?.id === selected.id ? "animate-pulse" : ""}`} />{batchProgress?.id === selected.id ? `测试中 ${Math.min(batchProgress.done + 1, batchProgress.total)}/${batchProgress.total}` : "测试并筛选模型"}</Button>
                <label className="ml-auto flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={selected.enabled} onChange={(e) => patchSelected({ enabled: e.target.checked })} className="accent-indigo-600" />启用</label>
                <Button variant="ghost" className="text-rose-600" onClick={() => { deleteProviderConnection(selected.id); setConnections(listProviderConnections()); }}><Trash2 className="size-4" />删除</Button>
              </div>
              {batchProgress?.id === selected.id && <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-xs leading-5 text-indigo-700">正在逐个测试模型可用性：{batchProgress.current}（{Math.min(batchProgress.done + 1, batchProgress.total)}/{batchProgress.total}），完成后自动只保留可用模型…</div>}
              {selected.lastTestMessage && <div className={`rounded-xl border p-3 text-xs ${chosenStatus?.tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{selected.lastTestMessage}</div>}
            </div>}
          </CardContent>
        </Card>
    </>)}

    {activeTab === "routing" && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Route className="size-5 text-indigo-600" />模型路由 · 每个进化环节可独立选择{routeSummary.filter((item) => item.live).length > 0 && <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{routeSummary.filter((item) => item.live).length} 个环节 Live</Badge>}{routeSummary.some((item) => !item.live) && <Badge className="border-amber-200 bg-amber-50 text-amber-700">{routeSummary.filter((item) => !item.live).length} 个环节 Demo/未配置</Badge>}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-slate-50 p-3 text-xs text-slate-600">
              <GitBranch className="size-4 text-indigo-600" /><b>推荐：</b>候选生成和独立评测使用不同模型/供应商，降低“自己生成、自己打分”的偏差。
              {evaluatorWarning && <Badge className="border-amber-200 bg-amber-50 text-amber-700">当前 Evaluator 与 Generator 相同</Badge>}
              <Button size="sm" variant="secondary" title="把每个环节的模型换成其连接上测试通过的模型（最近测通优先）；连接暂无测通记录的环节跳过" onClick={applyTestedToAllOperations}><CheckCircle2 className="size-4 text-emerald-600" />一键全部用测通</Button>
              <Button size="sm" variant="secondary" className="ml-auto" onClick={openAutoPlan}><Zap className="size-4 text-amber-500" />一键配置可用模型</Button>
            </div>
            {autoPlan && (
              <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-amber-900">配置预览：{autoPlan.rows.filter((row) => row.changed).length} 个环节将更新，{autoPlan.rows.filter((row) => !row.changed).length} 个保持不变</b>
                  {autoPlan.judgeIndependent
                    ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">评测将独立于生成</Badge>
                    : <Badge className="border-amber-200 bg-white text-amber-700">仅 1 个可用模型，评测暂无法独立</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {autoPlan.rows.filter((row) => row.changed).map((row) => (
                    <span key={row.operation} className="rounded-full border bg-white px-2.5 py-1 text-slate-600">
                      {row.label}：<span className="text-slate-400 line-through">{row.fromModel || "未设置"}</span> → <b className="text-emerald-700">{row.model}</b>
                    </span>
                  ))}
                  {!autoPlan.rows.some((row) => row.changed) && <span className="text-slate-500">所有环节已经在用最优可用模型，无需改动。</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={applyAutoPlan}>确认应用</Button>
                  <Button size="sm" variant="ghost" onClick={() => setAutoPlan(null)}>取消</Button>
                  <span className="text-[10px] text-slate-400">测试通过的模型优先；你正在使用的模型不会被换掉</span>
                </div>
              </div>
            )}
            <div className="overflow-auto rounded-2xl border">
              <table className="min-w-[860px] w-full border-collapse text-left text-xs">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">环节</th><th className="px-3 py-2.5">AI 角色</th><th className="px-3 py-2.5">供应商连接</th><th className="px-3 py-2.5">模型</th><th className="px-3 py-2.5">作用</th></tr></thead>
                <tbody>{(Object.keys(OPERATION_META) as AiOperation[]).map((operation) => {
                  const route = routing.operationRoutes[operation] ?? routing.defaultRoute;
                  const connection = connections.find((item) => item.id === route?.connectionId);
                  const models = connection ? [...new Set([route?.model || "", connection.defaultModel, ...connection.models])].filter(Boolean) : [];
                  const currentModel = route?.model ?? connection?.defaultModel ?? "";
                  const testedList = (connection?.testedModels ?? []).filter(Boolean);
                  const isTested = testedList.includes(currentModel);
                  const health = routeSummary.find((item) => item.operation === operation);
                  return <tr key={operation} className="border-t"><td className="px-3 py-2.5"><div className="font-semibold text-slate-800">{OPERATION_META[operation].label}</div><div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">{health?.live ? <span className="font-semibold text-emerald-600">● Live</span> : <span className="font-semibold text-amber-600">○ Demo / 未配置</span>}{health?.independentEvaluatorWarning && <Badge className="border-amber-200 bg-amber-50 text-amber-700">需独立 Judge</Badge>}</div></td><td className="px-3 py-2.5 text-slate-500">{OPERATION_META[operation].role}</td><td className="px-3 py-2.5"><select className="h-8 w-full rounded-lg border bg-white px-2" value={route?.connectionId ?? ""} onChange={(e) => setOperationRoute(operation, e.target.value, connections.find((item) => item.id === e.target.value)?.defaultModel)}><option value="">自动 / Demo</option>{connections.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></td><td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><ModelCombobox className="h-8 w-full rounded-lg border bg-white px-2 text-xs" models={models} tested={connection?.testedModels} notes={connection?.modelNotes} value={currentModel} onChange={(model) => setOperationModel(operation, model)} placeholder="搜索或输入模型 ID"/><button type="button" title={isTested ? "当前已在用测试通过的模型" : testedList.length ? `一键使用该连接测试通过的模型（当前测通 ${testedList.length} 个，最近测通优先）` : "该连接暂无测通模型：先点「测试」或「测试并筛选模型」"} disabled={!connection || !testedList.length || isTested} onClick={() => setOperationModel(operation, testedList[0]!)} className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">✓</button><button type="button" title={route?.connectionId ? `把「${OPERATION_META[operation].label}」当前的连接与模型一键应用到所有环节` : "先给该环节选择供应商连接，才能一键应用到所有环节"} disabled={!route?.connectionId} onClick={() => applyRouteToAllOperations(operation)} className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 p-1 text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"><Copy className="size-3" /></button></div><div className="mt-0.5 text-[10px]">{connection && currentModel ? (isTested ? <span className="text-emerald-600">✓ 已测通</span> : <span className="text-amber-600">○ 未测通 · 执行时可能失败</span>) : <span className="text-slate-300">未选连接</span>}</div></td><td className="px-3 py-2.5 text-slate-400">{OPERATION_META[operation].purpose}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
              <b className="text-slate-500">常用方案：</b>
              {!presets.length && <span className="text-slate-400">还没有方案。配好路由后点「保存当前」，以后一键套用。</span>}
              {presets.map((preset) => (
                <span key={preset.id} className="inline-flex items-center gap-1 rounded-full border bg-white py-1 pl-2.5 pr-1 shadow-sm">
                  <button type="button" title={`${preset.note ? `${preset.note}\n` : ""}保存于 ${preset.savedAt.slice(0, 16).replace("T", " ")}`} onClick={() => { saveAiRoutingPolicy(preset.policy); setRouting(preset.policy); setMessage(`已套用方案「${preset.name}」。`); }} className="max-w-40 truncate font-medium text-slate-700 hover:text-indigo-600">{preset.name}</button>
                  {preset.note && <span className="max-w-32 truncate text-[10px] text-slate-400" title={preset.note}>{preset.note}</span>}
                  <button type="button" aria-label={`删除方案 ${preset.name}`} onClick={() => { deleteRoutingPreset(preset.id); setPresets(listSavedRoutingPresets()); }} className="rounded-full px-1 text-slate-300 hover:text-rose-500">✕</button>
                </span>
              ))}
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <input className="h-8 w-28 rounded-lg border bg-white px-2 text-xs outline-none focus:border-indigo-400" placeholder="方案名称" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
                <input className="h-8 w-36 rounded-lg border bg-white px-2 text-xs outline-none focus:border-indigo-400" placeholder="备注（可选，如：主力配置）" value={presetNote} onChange={(e) => setPresetNote(e.target.value)} />
                <Button size="sm" variant="secondary" onClick={savePreset}><WandSparkles className="size-3.5" />保存当前</Button>
                <Button size="sm" variant="ghost" onClick={exportRouting}>导出 JSON</Button>
                <Button size="sm" variant="ghost" onClick={() => importFileRef.current?.click()}>导入</Button>
                <input ref={importFileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importRouting(file); e.target.value = ""; }} />
              </div>
            </div>
      </CardContent>
    </Card>
    )}


    {activeTab === "monitor" && (
    <Card>
      <CardHeader><CardTitle className="flex flex-wrap items-center gap-2"><Activity className="size-5 text-indigo-600" />运行监控与环境{recentAuditCount >= 3 && <Badge className="border-rose-200 bg-rose-50 text-rose-700">近 24 小时降级 {recentAuditCount} 次 · 失败偏多，请检查模型连接</Badge>}{recentAuditCount > 0 && recentAuditCount < 3 && <Badge className="border-amber-200 bg-amber-50 text-amber-700">近 24 小时降级 {recentAuditCount} 次</Badge>}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">当前运行环境</div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-slate-50 p-4">
            <div><div className="text-sm font-semibold">{runnerStatus.target.name}</div><div className="mt-1 text-xs text-slate-400">Adapter · {runnerStatus.target.adapter}</div></div>
            <Badge>{runnerStatus.target.adapter === "artifact" ? "Artifact Runtime" : runnerStatus.target.live ? "HTTP Target" : "Mock Target"}</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-xl border bg-indigo-50 p-3 text-xs leading-5 text-indigo-800 md:col-span-3">AI Provider 决定“谁负责分析、生成与评测”；Target Adapter 决定“被进化对象在哪里真实运行”。两者必须分开配置。</div>
            <div className="rounded-xl border p-3"><b className="text-sm">Prototype BYOK</b><p className="mt-1 text-xs leading-5 text-slate-500">当前源码支持浏览器本地保存多个 Key 以便快速验证。适合个人/内网原型。</p></div>
            <div className="rounded-xl border p-3"><b className="text-sm">Production Vault</b><p className="mt-1 text-xs leading-5 text-slate-500">正式部署应把 Key 移到服务端 Vault/KMS，前端只保存 connectionId，不保存密钥明文。</p></div>
            <div className="rounded-xl border p-3"><b className="text-sm">Independent Judge</b><p className="mt-1 text-xs leading-5 text-slate-500">Eval / Release Review 优先使用与 Candidate Generator 不同的模型，必要时再增加人工抽检。</p></div>
          </div>
        </section>
        <Separator />
        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">AI 过程留痕</div>
      {!auditEvents.length && <div className="rounded-2xl border border-dashed p-6 text-center text-xs text-slate-400">暂无异常留痕 —— 最近 AI 连接都顺利完成了任务。</div>}
      {(auditExpanded ? shownAuditEvents : shownAuditEvents.slice(0, 8)).map((event, index) => {
        const meta = auditKindMeta(event.kind);
        return (
          <div key={`${event.at}-${index}`} className="flex items-start gap-3 rounded-xl border p-3">
            <div className={cn("grid size-8 shrink-0 place-items-center rounded-lg", meta.severe ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600")}>{meta.severe ? <CircleAlert className="size-4" /> : <RefreshCcw className="size-4" />}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">{OPERATION_META[event.operation as AiOperation]?.label ?? event.operation}
                <Badge className={meta.severe ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{meta.label}</Badge>
                <span className="text-[10px] font-normal text-slate-400">{event.at.slice(0, 16).replace("T", " ")}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500" title={`${event.model}：${event.message}`}>{event.model}：{event.message}</div>
            </div>
          </div>
        );
      })}
      {!!auditEvents.length && <div className="text-[10px] text-slate-400">显示 {Math.min(auditExpanded ? shownAuditEvents.length : 8, shownAuditEvents.length)} / {shownAuditEvents.length} 条{auditFilter ? `（已按「${OPERATION_META[auditFilter as AiOperation]?.label ?? auditFilter}」筛选）` : ""}</div>}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
        {auditOptions.length > 1 && (
          <select className="h-8 rounded-lg border bg-white px-2 text-xs outline-none focus:border-indigo-400" value={auditFilter} onChange={(e) => { setAuditFilter(e.target.value); setAuditExpanded(false); }}>
            <option value="">全部环节</option>
            {auditOptions.map((operation) => <option key={operation} value={operation}>{OPERATION_META[operation as AiOperation]?.label ?? operation}</option>)}
          </select>
        )}
        {shownAuditEvents.length > 8 && <Button size="sm" variant="ghost" onClick={() => setAuditExpanded(!auditExpanded)}>{auditExpanded ? "收起" : `展开全部 ${shownAuditEvents.length} 条`}</Button>}
        <Button size="sm" variant="ghost" onClick={() => setAuditEvents(listAiAuditEvents())}><RefreshCcw className="size-3.5" />刷新</Button>
        {!!auditEvents.length && <Button size="sm" variant="ghost" onClick={() => {
          // 导出仅含时间/环节/模型/错误摘要，不含任何密钥内容，可安全发给技术支持。
          const blob = new Blob([JSON.stringify({ app: "evolve-studio-ai-audit", exportedAt: new Date().toISOString(), events: auditEvents }, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "evolve-ai-audit.json";
          anchor.click();
          URL.revokeObjectURL(url);
          setMessage(`已导出 ${auditEvents.length} 条 AI 过程留痕（仅错误摘要，不含任何 API Key）。`);
        }}><ExternalLink className="size-3.5" />导出留痕</Button>}
        {!!auditEvents.length && <Button size="sm" variant="ghost" onClick={() => { clearAiAuditEvents(); setAuditEvents([]); }}><Trash2 className="size-3.5" />清空日志</Button>}
      </div>
        </section>
      </CardContent>
    </Card>
    )}


    {activeTab === "target" && (<>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ScanSearch className="size-5 text-sky-600" />成果物解析与 Parser Router</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="rounded-2xl border border-sky-100 bg-sky-50/50 p-4 text-xs leading-5 text-sky-900"><b>V3.0 零配置解析原则：</b>默认无需配置即可使用内置解析：ZIP/代码走 Repository Intelligence，PPTX/DOCX/XLSX/PDF/文本走浏览器本地解析。Docling / Unstructured / Tika / Custom 只是可选增强，不配置也能正常创建和进化项目；外部解析失败会自动回退本地。</div>
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <label><span className="mb-1 block text-xs text-slate-400">路由模式</span><select className={inputCls} value={parserConfig.kind} onChange={(e)=>setParserConfig({...parserConfig,kind:e.target.value as ParserGatewayConfig["kind"],enabled:e.target.value!=="off"})}><option value="off">内置零配置解析（推荐）</option><option value="auto">自动路由 + 可选增强</option><option value="docling">只用 Docling</option><option value="unstructured">只用 Unstructured</option><option value="tika">只用 Apache Tika</option><option value="custom">只用 Custom Parser</option></select></label>
        <div className="rounded-xl border bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">内置解析默认即可工作：<b>ZIP/Code → Local Repository Intelligence</b>；<b>PPTX/DOCX/XLSX/PDF/Text → Local Parser</b>。只有复杂扫描件/版面/OCR 或企业专用格式才需要开启下方增强服务；开启后按配置顺序 Failover。</div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {PARSER_SERVICES.map((meta)=>{const service=parserConfig.services[meta.kind];const testing=busyId===`parser:${meta.kind}`;return <div key={meta.kind} className={cn("rounded-2xl border p-4",service.enabled?"border-sky-200 bg-sky-50/30":"bg-white")}>
          <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{meta.label}</div><p className="mt-1 text-xs leading-5 text-slate-500">{meta.note}</p></div><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={service.enabled} onChange={(e)=>setParserConfig({...parserConfig,enabled:true,kind:parserConfig.kind==="off"?"auto":parserConfig.kind,services:{...parserConfig.services,[meta.kind]:{...service,enabled:e.target.checked}}})} className="accent-sky-600"/>启用</label></div>
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_130px]"><input className={inputCls} value={service.endpoint} onChange={(e)=>setParserConfig({...parserConfig,services:{...parserConfig.services,[meta.kind]:{...service,endpoint:e.target.value}}})} placeholder={meta.placeholder}/><input type="number" className={inputCls} value={service.timeoutMs} onChange={(e)=>setParserConfig({...parserConfig,services:{...parserConfig.services,[meta.kind]:{...service,timeoutMs:Math.max(1000,Number(e.target.value)||90000)}}})} title="Timeout/ms"/></div>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]"><input type="password" className={inputCls} value={service.apiKey??""} onChange={(e)=>setParserConfig({...parserConfig,services:{...parserConfig.services,[meta.kind]:{...service,apiKey:e.target.value||undefined}}})} placeholder={meta.kind==="docling"?"API Key（Docling 使用 X-Api-Key，可留空）":meta.kind==="unstructured"?"Unstructured API Key（可留空）":"API Key（可选）"}/><Button size="sm" variant="secondary" disabled={!service.endpoint.trim()||testing} onClick={async()=>{setBusyId(`parser:${meta.kind}`);const result=await testParserService(meta.kind,service);setMessage(`${meta.label}：${result.message}（${result.latencyMs}ms）`);setBusyId(undefined)}}>{testing?<RefreshCcw className="size-3.5 animate-spin"/>:<Stethoscope className="size-3.5"/>}测试解析连接</Button></div>
        </div>})}
      </div>
      <div className="flex flex-wrap items-center gap-2"><Button onClick={()=>{saveParserGatewayConfig(parserConfig);setMessage(`Parser Router 已保存：${parserConfig.kind}`)}}>保存解析设置</Button><Badge>{parserConfig.kind==="auto"?"Auto routing":parserConfig.enabled?`Parser: ${parserConfig.kind}`:"Local only"}</Badge><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">代码 ZIP 始终优先 Local AST/Dependency Graph</Badge></div>
      <div className="rounded-xl border bg-white p-3 text-xs leading-5 text-slate-500"><b>生产建议：</b>Browser Local 继续负责 ZIP Manifest、原格式回写与代码 Repository Intelligence；Docling/Unstructured/Tika 负责补充复杂文档解析。正式部署建议把外部 Parser 请求放到后端 Parser Gateway，API Key 不保存在浏览器。</div>
    </CardContent></Card>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ServerCog className="size-5 text-emerald-600" />后台验证能力</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-xs leading-5 text-slate-500">内置执行器随应用自动启动。上传 HTML 后，系统自动调用真实浏览器、采集桌面与手机截图，并执行测试中声明的交互断言，无需在项目中配置连接。工程构建和线上发布按实际部署能力单独检测。</p>
      <div className={`rounded-xl border p-3 text-xs leading-5 ${runnerTesting?"border-indigo-100 bg-indigo-50 text-indigo-700":runnerOk?"border-emerald-100 bg-emerald-50 text-emerald-800":"border-amber-100 bg-amber-50 text-amber-800"}`}>
        <div className="font-semibold">{runnerTesting?"正在检测后台执行环境…":runnerOk?"真实执行能力已就绪":"后台能力需要补齐"}</div>
        <div className="mt-1">{runnerTesting?"检查浏览器能否实际启动及工程构建环境，不把接口在线当作测试通过。":runnerTest??"打开此页面后自动检测。"}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={runnerTesting} onClick={()=>void checkRunner()}><RefreshCcw className={`size-4 ${runnerTesting?"animate-spin":""}`} />重新检测后台能力</Button>
        {!isBuiltinRunnerGateway(runnerGateway)&&<Button variant="ghost" disabled={runnerTesting} onClick={()=>{const next=resetRunnerGatewayConfig();setRunnerGateway(next);void checkRunner(next);}}>恢复内置执行器</Button>}
      </div>
      <details className="rounded-xl border p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">高级设置：接入自定义工程 / E2E / 发布执行器</summary>
      <p className="my-3 text-xs leading-5 text-slate-500">浏览器固定连接同源 Server Target Proxy。真实 Run / Release URL 与 Bearer Token 只能配置在服务器 EVOLUTION_TARGET_* 环境变量中，不再保存到浏览器或 localStorage。</p>
      <div className="grid gap-2 lg:grid-cols-2">
        <label className="text-xs text-slate-600">连接名称<Input value={runnerGateway.label} onChange={(event)=>setRunnerGateway({...runnerGateway, label:event.target.value})} placeholder="Server Target Proxy" /></label>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Run：/api/evolution/target-run<br/>Release：/api/evolution/target-release</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={()=>{ saveRunnerGatewayConfig(runnerGateway); setRunnerStatus(getRunnerStatus()); setMessage("Runner 网关配置已保存"); }}><Save className="size-4" />保存 Runner 配置</Button>
        <Button variant="secondary" disabled={runnerTesting} onClick={()=>void checkRunner()}><PlugZap className="size-4" />检测执行能力</Button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={runnerGateway.enabled} onChange={(event)=>setRunnerGateway({...runnerGateway, enabled:event.target.checked})} />启用该网关</label>
      </div>
      <p className="text-xs leading-5 text-slate-400">Server Proxy 负责真实外部出站与鉴权；浏览器只发送业务 payload，所有生产平台凭证均留在服务器。</p>
      </details>
    </CardContent></Card>
    </>)}

  </div>;
}
