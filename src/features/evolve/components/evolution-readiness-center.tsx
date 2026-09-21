import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Boxes,
  BrainCircuit,
  CircleAlert,
  CloudCog,
  Database,
  GitBranch,
  LockKeyhole,
  Network,
  RefreshCcw,
  Rocket,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { getAiProviderStatus } from "../ai/service";
import { useLocalProjects } from "../runtime/use-local-projects";
import {
  BACKEND_REQUIREMENTS,
  EVOLUTION_PHASES,
  backendRequirementState,
  deriveEngineReadiness,
  projectLoopSummary,
  type ReadinessState,
  type RunnerCapabilitySnapshot,
} from "../runtime/system-readiness";
import { deriveWorkflowSteps } from "../runtime/workflow-engine";
import { getRunnerGatewayConfig, testRunnerGateway } from "../runtime/target-runner-config";
import { PRODUCTION_BOUNDARIES, PRODUCTION_SCHEMA_VERSIONS, PRODUCTION_PORTS, type ConnectorRegistryCapabilities, type EvidenceLedgerHealth, type EvolutionBackendHealth, type EvolutionWorkflowCapabilities, type GitTargetCapabilities, type OrganizationCapabilityHealth, type OutcomeAnalyticsHealth, type SandboxBrowserHealth, type SandboxHealth, type VercelReleaseCapabilities, type VercelReleaseHealth } from "@evolution/contracts";
import { productionRuntimeMode } from "../runtime/production-runtime";
import { productionSyncStatus } from "../runtime/production-sync";
import { checkServerBackendHealth, checkServerBrowserHealth, checkServerSandboxHealth, getServerWorkflowCapabilities } from "../runtime/server-workflow-client";
import { checkServerVercelReleaseHealth, getServerVercelReleaseCapabilities } from "../runtime/server-release-client";
import { getServerGitTargetCapabilities } from "../runtime/server-git-client";
import { getServerOrganizationCapabilityHealth } from "../runtime/server-capability-client";
import { getServerEvidenceLedgerHealth } from "../runtime/server-evidence-ledger-client";
import { getServerConnectorCapabilities } from "../runtime/server-connector-client";
import { getServerOutcomeHealth } from "../runtime/server-outcome-client";
import { HarnessInspector } from "./harness-inspector";

function readRunnerCapabilities(): RunnerCapabilitySnapshot | undefined {
  try {
    const raw = window.localStorage.getItem("evolve-runner-capabilities");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { capabilities?: RunnerCapabilitySnapshot };
    return parsed.capabilities;
  } catch {
    return undefined;
  }
}

function workflowCapabilityMessage(capabilities: EvolutionWorkflowCapabilities) {
  if (capabilities.fullAuto) return "Durable Workflow 已具备离线 + 线上完整 AutoPilot 接管能力";
  return [
    capabilities.closure.offlineFullAuto
      ? "离线闭环：FULL AUTO"
      : capabilities.closure.codeReady
        ? "离线闭环代码已就绪，但仍有配置阻塞"
        : "离线闭环代码尚未就绪",
    capabilities.closure.onlineFullAuto
      ? "线上闭环：FULL AUTO"
      : capabilities.closure.onlinePostApprovalAuto
        ? "线上闭环：授权 + Preview 绑定后 AUTO"
        : `线上闭环：${capabilities.closure.externalCapabilityBlocked.map((item) => item.capability).join("、") || "待能力接入"}`,
    capabilities.migrationPendingActions.length ? `待迁：${capabilities.migrationPendingActions.join("、")}` : "",
    capabilities.closure.configBlocked.length ? `待配置：${capabilities.closure.configBlocked.map((item) => item.capability).join("、")}` : "",
  ].filter(Boolean).join("；");
}

const stateStyles: Record<ReadinessState, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
  local: "border-sky-200 bg-sky-50 text-sky-800",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  backend: "border-violet-200 bg-violet-50 text-violet-800",
  blocked: "border-rose-200 bg-rose-50 text-rose-800",
};

const stateLabel: Record<ReadinessState, string> = {
  ready: "真实可用",
  local: "本地闭环",
  partial: "部分闭环",
  backend: "待后端",
  blocked: "阻塞",
};

const backendIcons = {
  "control-plane": ServerCog,
  "git-target": GitBranch,
  sandbox: Boxes,
  release: Rocket,
  "capability-service": Sparkles,
  "vault-rbac": LockKeyhole,
  "evidence-ledger": Database,
  "outcome-science": Activity,
  connectors: Network,
} as const;

export function EvolutionReadinessCenter() {
  const projects = useLocalProjects({ includeDemo: false });
  const [activeTab, setActiveTab] = useState("overview");
  const [engineFilter, setEngineFilter] = useState<"all" | "gaps">("all");
  const [backendPriority, setBackendPriority] = useState<"all" | "P0" | "P1" | "P2">("P0");
  const [runner, setRunner] = useState<RunnerCapabilitySnapshot | undefined>(() => readRunnerCapabilities());
  const [runnerCheck, setRunnerCheck] = useState<{ busy: boolean; message: string }>({ busy: false, message: "" });
  const [syncCheck, setSyncCheck] = useState<{ liveStatus: string }>(() => ({ liveStatus: productionSyncStatus().realtimeStatus }));
  const [workflowCheck, setWorkflowCheck] = useState<{ busy: boolean; message: string; capabilities?: EvolutionWorkflowCapabilities }>({ busy: false, message: "" });
  const [backendHealthCheck,setBackendHealthCheck]=useState<{busy:boolean;message:string;health?:EvolutionBackendHealth}>({busy:false,message:""});
  const [sandboxCheck, setSandboxCheck] = useState<{ busy: boolean; message: string; health?: SandboxHealth }>({ busy: false, message: "" });
  const [browserCheck, setBrowserCheck] = useState<{ busy: boolean; message: string; health?: SandboxBrowserHealth }>({ busy: false, message: "" });
  const [releaseCheck, setReleaseCheck] = useState<{ busy: boolean; message: string; capabilities?: VercelReleaseCapabilities; health?: VercelReleaseHealth }>({ busy: false, message: "" });
  const [gitCheck,setGitCheck]=useState<{busy:boolean;message:string;capabilities?:GitTargetCapabilities}>({busy:false,message:""});
  const [capabilityCheck,setCapabilityCheck]=useState<{busy:boolean;message:string;health?:OrganizationCapabilityHealth}>({busy:false,message:""});
  const [evidenceLedgerCheck,setEvidenceLedgerCheck]=useState<{busy:boolean;message:string;health?:EvidenceLedgerHealth}>({busy:false,message:""});
  const [connectorCheck,setConnectorCheck]=useState<{busy:boolean;message:string;capabilities?:ConnectorRegistryCapabilities}>({busy:false,message:""});
  const [outcomeCheck,setOutcomeCheck]=useState<{busy:boolean;message:string;health?:OutcomeAnalyticsHealth}>({busy:false,message:""});
  const visualJudgeLive = getAiProviderStatus("visual-judge").live;
  const signals = useMemo(() => ({
    runner,
    visualJudgeLive,
    server: {
      controlPlane: Boolean(workflowCheck.capabilities?.available && workflowCheck.capabilities?.durable),
      dataPlane: Boolean(
        backendHealthCheck.health?.dataPlane.database
        && backendHealthCheck.health?.dataPlane.storage
        && Object.values(backendHealthCheck.health.dataPlane.tables).every(Boolean)
      ),
      sourceParse: Boolean(backendHealthCheck.health?.sourceParse.codeReady && backendHealthCheck.health?.sourceParse.configured),
      artifactStore: Boolean(backendHealthCheck.health?.dataPlane.storage),
      artifactRenderer: Boolean(backendHealthCheck.health?.artifactRenderer.codeReady&&backendHealthCheck.health?.artifactRenderer.configured),
      serverAi: Boolean(backendHealthCheck.health?.serverAi.codeReady && backendHealthCheck.health?.serverAi.configured),
      sandbox: Boolean(sandboxCheck.health?.ready),
      browser: Boolean(browserCheck.health?.ready),
      release: Boolean(releaseCheck.capabilities?.writeEnabled),
      git: Boolean(gitCheck.capabilities?.configured&&gitCheck.capabilities?.allowlistConfigured&&gitCheck.capabilities?.webhookConfigured),
      capabilityService: Boolean(capabilityCheck.health?.configured&&capabilityCheck.health?.databaseReady),
      capabilitySemantic: Boolean(capabilityCheck.health?.vectorSearch),
      capabilitySharing: Boolean(capabilityCheck.health?.sharingRbacReady),
      evidenceLedger: Boolean(
        evidenceLedgerCheck.health?.configured
        && evidenceLedgerCheck.health.databaseReady
        && evidenceLedgerCheck.health.signingConfigured
        && evidenceLedgerCheck.health.appendFunctionReady
        && evidenceLedgerCheck.health.immutableTriggerReady
      ),
      evidenceSigningProvider: evidenceLedgerCheck.health?.signingProvider,
      security: Boolean(backendHealthCheck.health?.security.productionSafe),
      vault: Boolean(backendHealthCheck.health?.securityGovernance.vaultConfigured&&backendHealthCheck.health?.securityGovernance.vaultDatabaseReady),
      approvalStore: Boolean(backendHealthCheck.health?.securityGovernance.approvalStoreReady),
      connectors: Boolean(connectorCheck.capabilities?.fullLifecycleCount),
      outcome: Boolean(
        outcomeCheck.health?.databaseReady
        && outcomeCheck.health.ingestionReady
        && outcomeCheck.health.analysisReady
      ),
    },
  }), [backendHealthCheck.health, browserCheck.health, capabilityCheck.health, connectorCheck.capabilities, evidenceLedgerCheck.health, gitCheck.capabilities, outcomeCheck.health, releaseCheck.capabilities, runner, sandboxCheck.health, visualJudgeLive, workflowCheck.capabilities]);
  const engines = useMemo(() => deriveEngineReadiness(signals), [signals]);
  const summaries = useMemo(() => projects.map((project) => ({ project, loop: projectLoopSummary(project) })), [projects]);
  const latestProject = useMemo(() => projects.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0], [projects]);
  const closed = summaries.filter((item) => item.loop.complete).length;
  const blocked = summaries.filter((item) => item.loop.blocked > 0).length;
  const average = summaries.length ? Math.round(summaries.reduce((sum, item) => sum + item.loop.percent, 0) / summaries.length) : 0;
  const backendReady = BACKEND_REQUIREMENTS.filter((item) => backendRequirementState(item, signals) === "ready").length;
  const p0 = BACKEND_REQUIREMENTS.filter((item) => item.priority === "P0");
  const p0Ready = p0.filter((item) => backendRequirementState(item, signals) === "ready").length;
  const productionMode = productionRuntimeMode();
  const productionContractsReady = PRODUCTION_BOUNDARIES.filter((item) => item.ready).length;
  const productionModeLabel = productionMode === "http" ? "SERVER API" : "LOCAL ADAPTER";
  const serverDataPlaneReady=Boolean(backendHealthCheck.health?.dataPlane.database&&backendHealthCheck.health?.dataPlane.storage);
  const dataPlaneReady=productionMode==="http"?serverDataPlaneReady:false;
  const remoteSyncReady=productionMode==="http"&&syncCheck.liveStatus==="http-polling";
  const p02Ready = Boolean(dataPlaneReady && remoteSyncReady);
  const p03Connected = Boolean(workflowCheck.capabilities?.available && workflowCheck.capabilities?.durable);
  const p03FullAuto = Boolean(workflowCheck.capabilities?.fullAuto);
  const p03OfflineAuto = Boolean(workflowCheck.capabilities?.closure.offlineFullAuto);
  const p04Ready = Boolean(sandboxCheck.health?.ready);
  const p04BrowserReady = Boolean(browserCheck.health?.ready);
  const releaseReadReady = Boolean(releaseCheck.capabilities?.readEnabled && releaseCheck.health?.ready);
  const releaseWriteReady = Boolean(releaseCheck.capabilities?.writeEnabled);
  const gitConfigured=Boolean(gitCheck.capabilities?.configured&&gitCheck.capabilities?.allowlistConfigured);
  const gitReady=Boolean(gitConfigured&&gitCheck.capabilities?.webhookConfigured);
  const connectorCount=connectorCheck.capabilities?.connectorCount??0;
  const connectorFullCount=connectorCheck.capabilities?.fullLifecycleCount??0;
  const hybridFunctionalReady = Boolean(p02Ready && p04Ready);
  const hybridInteractionReady = Boolean(hybridFunctionalReady && p04BrowserReady);
  const visibleEngines = engineFilter === "gaps"
    ? engines.filter((engine) => engine.state !== "ready" && engine.state !== "local")
    : engines;
  const visibleBackendRequirements = backendPriority === "all"
    ? BACKEND_REQUIREMENTS
    : BACKEND_REQUIREMENTS.filter((item) => item.priority === backendPriority);
  const targetCoverage = [
    { target: "文件 / Office / HTML Artifact", state: backendHealthCheck.health?.artifactRenderer.configured ? "ready" : "partial", read: "✓", snapshot: "✓", mutate: "✓", validate: backendHealthCheck.health?.artifactRenderer.configured ? "Server Render + Reopen Verify" : "Browser Verify", deploy: backendHealthCheck.health?.artifactRenderer.configured ? "Artifact Store" : "本地交付", observe: "结构/Hash Evidence", rollback: "✓", gap: backendHealthCheck.health?.artifactRenderer.configured ? "PDF/设计类保持 external-required；视觉/公式重算继续补强" : "Server Renderer 等待 Artifact Store/Data Plane" },
    { target: "HTML / Web 页面", state: p04BrowserReady || (runner?.htmlBrowser && runner?.e2e) ? "ready" : "partial", read: "✓", snapshot: "✓", mutate: "✓", validate: p04BrowserReady ? "Chromium Steps" : runner?.e2e ? "✓" : "部分", deploy: p04BrowserReady ? "Sandbox Preview" : "Preview", observe: p04BrowserReady ? "真实交互" : runner?.screenshots ? "✓" : "部分", rollback: "✓", gap: p04BrowserReady ? "Route Matrix / 视觉审查继续扩展" : "工程级 Preview / Browser Runtime" },
    { target: "ZIP / Codebase", state: p04BrowserReady ? "partial" : p04Ready ? "partial" : runner?.build ? "partial" : "backend", read: "✓", snapshot: "✓", mutate: "✓", validate: p04BrowserReady ? "Build/Test + Browser" : p04Ready ? "Sandbox Build/Test" : runner?.build ? "Build" : "静态", deploy: p04BrowserReady ? "Sandbox Preview" : "待 Preview", observe: p04BrowserReady ? "Browser Steps / E2E" : p04Ready ? "执行证据" : "待后端", rollback: "ZIP", gap: p04BrowserReady ? "Git Target / Production Deploy 后续补齐" : p04Ready ? "Browser Runtime / Preview" : "Git + Sandbox + Preview Runtime" },
    { target: "Production HTTP Target", state: releaseWriteReady || runner?.release ? "ready" : releaseReadReady ? "partial" : "backend", read: "连接", snapshot: "Hash", mutate: "Deploy", validate: releaseCheck.capabilities?.mode==="preview-promote" ? "Preview Gate" : "Canary", deploy: releaseWriteReady || runner?.release ? "✓" : "只读", observe: releaseReadReady || runner?.release ? "Health" : "待后端", rollback: releaseWriteReady || runner?.release ? "✓" : "待凭据", gap: releaseWriteReady || runner?.release ? "Production Release 已接通" : releaseReadReady ? "生产健康观测已接通；Promote/Rollback 仍需 VERCEL_RELEASE_TOKEN" : "Deploy / Traffic / Telemetry" },
    { target: "Git Repository", state: gitReady ? "ready" : gitConfigured ? "partial" : "backend", read: gitConfigured ? "GitHub API" : "待配置", snapshot: gitConfigured ? "Commit/Tree SHA" : "待配置", mutate: gitConfigured ? "Branch/Commit" : "待配置", validate: gitConfigured ? "Check Runs" : "待配置", deploy: gitConfigured ? "PR/Merge" : "待配置", observe: gitReady ? "Webhook" : gitConfigured ? "Polling" : "待配置", rollback: gitConfigured ? "Audit Commit" : "待配置", gap: gitReady ? "Git-native 生命周期已接通" : gitConfigured ? "补 EVOLUTION_GITHUB_WEBHOOK_SECRET 与仓库 Webhook" : "配置 GitHub Token + Repo allowlist" },
    { target: "Agent / Workflow / Memory / API / DB", state: connectorFullCount>0 ? "ready" : connectorCount>0 ? "partial" : "backend", read: connectorCount>0 ? "Manifest" : "待配置", snapshot: connectorCount>0 ? "按 Connector" : "待配置", mutate: connectorCount>0 ? "按 Connector" : "待配置", validate: connectorCount>0 ? "按 Connector" : "待配置", deploy: connectorCount>0 ? "按 Connector" : "待配置", observe: connectorCount>0 ? "Webhook/Observe" : "待配置", rollback: connectorCount>0 ? "按 Connector" : "待配置", gap: connectorFullCount>0 ? `${connectorFullCount} 个 Full Lifecycle Connector 已接通` : connectorCount>0 ? `${connectorCount} 个 Connector 已注册，但尚无 7/7 Full Lifecycle` : "配置 EVOLUTION_CONNECTORS_JSON 与具体 Lifecycle endpoints" },
  ] as const;
  const readinessTabs = [
    { value: "overview", label: "闭环总览", icon: <Workflow className="size-3.5" />, badge: <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px]">{EVOLUTION_PHASES.length}</span> },
    { value: "engines", label: "核心 Engine", icon: <Activity className="size-3.5" />, badge: <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px]">{engines.length}</span> },
    { value: "harness", label: "Harness / Runtime", icon: <BrainCircuit className="size-3.5" /> },
    { value: "backend", label: "后端缺口", icon: <CloudCog className="size-3.5" />, badge: <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">{BACKEND_REQUIREMENTS.length - backendReady}</span> },
    { value: "targets", label: "Target Adapter", icon: <Network className="size-3.5" />, badge: <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px]">{targetCoverage.length}</span> },
  ];

  useEffect(() => {
    const config = getRunnerGatewayConfig();
    if (!config.enabled || !config.runUrl.trim()) return;
    let active = true;
    queueMicrotask(() => { if (active) setRunnerCheck({ busy: true, message: "正在自动检测后台 Runner 能力…" }); });
    void testRunnerGateway(config).then((result) => {
      if (!active) return;
      setRunner(readRunnerCapabilities());
      setRunnerCheck({ busy: false, message: result.message });
    }).catch((error) => {
      if (!active) return;
      setRunnerCheck({ busy: false, message: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onRealtimeStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (status) setSyncCheck({ liveStatus: status });
    };
    window.addEventListener("evolve-production-realtime-status", onRealtimeStatus);
    return () => window.removeEventListener("evolve-production-realtime-status", onRealtimeStatus);
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setWorkflowCheck({ busy: true, message: "正在检测 Durable Workflow…" }); });
    void getServerWorkflowCapabilities(true).then((capabilities) => {
      if (!active) return;
      setWorkflowCheck({
        busy: false,
        capabilities,
        message: workflowCapabilityMessage(capabilities),
      });
    }).catch((error) => {
      if (active) setWorkflowCheck({ busy: false, message: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, []);

  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)setBackendHealthCheck({busy:true,message:"正在检测 Server Backend Data Plane…"});});
    void checkServerBackendHealth().then((health)=>{
      if(active)setBackendHealthCheck({busy:false,health,message:health.dataPlane.message});
    }).catch((error)=>{
      if(active)setBackendHealthCheck({busy:false,message:error instanceof Error?error.message:String(error)});
    });
    return ()=>{active=false;};
  },[]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setReleaseCheck({ busy: true, message: "正在检测 Production Release Provider…" }); });
    void Promise.all([getServerVercelReleaseCapabilities(), checkServerVercelReleaseHealth()]).then(([capabilities, health]) => {
      if (!active) return;
      setReleaseCheck({
        busy: false,
        capabilities,
        health,
        message: capabilities.writeEnabled
          ? "Vercel Release Read / Write 已就绪"
          : health.ready
            ? "Production Health 可观测；Promote / Rollback 仍需专用 Release Token"
            : health.message,
      });
    }).catch((error) => {
      if (active) setReleaseCheck({ busy: false, message: error instanceof Error ? error.message : String(error) });
    });
    return () => { active = false; };
  }, []);

  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)setGitCheck({busy:true,message:"正在检测 Git-native Target…"});});
    void getServerGitTargetCapabilities().then((capabilities)=>{
      if(!active)return;
      setGitCheck({
        busy:false,
        capabilities,
        message:capabilities.configured
          ?capabilities.webhookConfigured?"GitHub Target Read/Write/Webhook 已就绪":"GitHub Target 已配置；Webhook Secret 尚未配置"
          :"GitHub Target 代码已就绪，等待 Token + Repo allowlist",
      });
    }).catch((error)=>{
      if(active)setGitCheck({busy:false,message:error instanceof Error?error.message:String(error)});
    });
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)setCapabilityCheck({busy:true,message:"正在检测 Organization Capability Registry…"});});
    void getServerOrganizationCapabilityHealth().then((health)=>{
      if(active)setCapabilityCheck({busy:false,health,message:health.message});
    }).catch((error)=>{
      if(active)setCapabilityCheck({busy:false,message:error instanceof Error?error.message:String(error)});
    });
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)setEvidenceLedgerCheck({busy:true,message:"正在检测 Immutable Evidence Ledger…"});});
    void getServerEvidenceLedgerHealth().then((health)=>{
      if(active)setEvidenceLedgerCheck({busy:false,health,message:health.message});
    }).catch((error)=>{
      if(active)setEvidenceLedgerCheck({busy:false,message:error instanceof Error?error.message:String(error)});
    });
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)setConnectorCheck({busy:true,message:"正在检测 External Connector Registry…"});});
    void getServerConnectorCapabilities().then((capabilities)=>{
      if(!active)return;
      setConnectorCheck({
        busy:false,
        capabilities,
        message:capabilities.connectorCount
          ?`已注册 ${capabilities.connectorCount} 个 Connector；Full Lifecycle ${capabilities.fullLifecycleCount}`
          :"Connector SDK 代码已就绪，等待服务器 Manifest 配置",
      });
    }).catch((error)=>{
      if(active)setConnectorCheck({busy:false,message:error instanceof Error?error.message:String(error)});
    });
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)setOutcomeCheck({busy:true,message:"正在检测 Outcome Analytics…"});});
    void getServerOutcomeHealth().then((health)=>{
      if(active)setOutcomeCheck({busy:false,health,message:health.message});
    }).catch((error)=>{
      if(active)setOutcomeCheck({busy:false,message:error instanceof Error?error.message:String(error)});
    });
    return ()=>{active=false;};
  },[]);

  const refreshWorkflow = () => {
    setWorkflowCheck((current) => ({ ...current, busy: true, message: "正在重新检测 Workflow…" }));
    void getServerWorkflowCapabilities(true).then((capabilities) => setWorkflowCheck({
      busy: false,
      capabilities,
      message: workflowCapabilityMessage(capabilities),
    })).catch((error) => setWorkflowCheck({ busy: false, message: error instanceof Error ? error.message : String(error) }));
  };

  const refreshBackendHealth=()=>{
    setBackendHealthCheck((current)=>({...current,busy:true,message:"正在重新检测 Server Backend…"}));
    void checkServerBackendHealth()
      .then((health)=>setBackendHealthCheck({busy:false,health,message:health.dataPlane.message}))
      .catch((error)=>setBackendHealthCheck({busy:false,message:error instanceof Error?error.message:String(error)}));
  };

  const refreshSandbox = () => {
    setSandboxCheck((current) => ({ ...current, busy: true, message: "正在创建临时 Vercel Sandbox 做真实健康检查…" }));
    void checkServerSandboxHealth().then((health) => setSandboxCheck({ busy: false, health, message: health.message }))
      .catch((error) => setSandboxCheck({ busy: false, message: error instanceof Error ? error.message : String(error) }));
  };

  const refreshBrowser = () => {
    setBrowserCheck((current) => ({ ...current, busy: true, message: "正在准备 Browser Runtime Snapshot 并启动 Chromium…" }));
    void checkServerBrowserHealth().then((health) => setBrowserCheck({ busy: false, health, message: health.message }))
      .catch((error) => setBrowserCheck({ busy: false, message: error instanceof Error ? error.message : String(error) }));
  };

  const refreshRelease = () => {
    setReleaseCheck((current) => ({ ...current, busy: true, message: "正在重新检测 Production Release…" }));
    void Promise.all([getServerVercelReleaseCapabilities(), checkServerVercelReleaseHealth()]).then(([capabilities, health]) => {
      setReleaseCheck({
        busy: false,
        capabilities,
        health,
        message: capabilities.writeEnabled
          ? "Vercel Release Read / Write 已就绪"
          : health.ready
            ? "Production Health 可观测；Promote / Rollback 仍需专用 Release Token"
            : health.message,
      });
    }).catch((error) => setReleaseCheck({ busy: false, message: error instanceof Error ? error.message : String(error) }));
  };

  const refreshGit=()=>{
    setGitCheck((current)=>({...current,busy:true,message:"正在重新检测 Git Target…"}));
    void getServerGitTargetCapabilities()
      .then((capabilities)=>setGitCheck({
        busy:false,
        capabilities,
        message:capabilities.configured
          ?capabilities.webhookConfigured?"GitHub Target Read/Write/Webhook 已就绪":"GitHub Target 已配置；Webhook Secret 尚未配置"
          :"GitHub Target 代码已就绪，等待 Token + Repo allowlist",
      }))
      .catch((error)=>setGitCheck({busy:false,message:error instanceof Error?error.message:String(error)}));
  };

  const refreshRunner = () => {
    const config = getRunnerGatewayConfig();
    setRunnerCheck({ busy: true, message: "正在重新检测…" });
    void testRunnerGateway(config).then((result) => {
      setRunner(readRunnerCapabilities());
      setRunnerCheck({ busy: false, message: result.message });
    }).catch((error) => setRunnerCheck({ busy: false, message: error instanceof Error ? error.message : String(error) }));
  };

  return <div className="space-y-5">
    <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div>
        <div className="text-xs font-semibold text-indigo-600">Evolution Readiness</div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">进化闭环完整性中心</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
          这里不是功能清单，而是系统级验收表：从目标、实验、证据、成果到生产 Outcome 和学习，逐层判断是否形成真实闭环，并把必须依赖后端的能力集中列出。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">23 个流程节点</Badge>
        <Badge className="border-sky-200 bg-sky-50 text-sky-700">8 个闭环阶段</Badge>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">9 个 Engine</Badge>
      </div>
    </section>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="项目平均闭环" value={projects.length ? `${average}%` : "—"} sub={projects.length ? `${closed}/${projects.length} 个项目完整闭环` : "创建项目后自动计算"} icon={<Workflow className="size-4" />} />
      <Stat label="阻塞项目" value={String(blocked)} sub="存在 blocked workflow node" icon={<CircleAlert className="size-4" />} tone={blocked ? "amber" : "emerald"} />
      <Stat label="P0 后端能力" value={`${p0Ready}/${p0.length}`} sub="Build / Release 可自动探测" icon={<CloudCog className="size-4" />} tone={p0Ready === p0.length ? "emerald" : "violet"} />
      <Stat label="全部后端能力" value={`${backendReady}/${BACKEND_REQUIREMENTS.length}`} sub="未就绪能力不会伪装成已完成" icon={<ShieldCheck className="size-4" />} tone="slate" />
    </div>

    <div className="sticky top-[3.75rem] z-20 rounded-2xl border bg-white/90 p-2 shadow-sm backdrop-blur-xl">
      <Tabs items={readinessTabs} value={activeTab} onValueChange={setActiveTab} className="bg-transparent" />
    </div>

    {activeTab === "overview" && <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="text-base">完整进化闭环 · 23 节点 / 8 阶段</CardTitle><p className="mt-1 text-xs leading-5 text-slate-500">离线成果可以在第 6 阶段闭环；需要生产验证的任务继续进入第 7 阶段，最终都必须经过学习和 Next Queue 才算完整结束。</p></div>
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">流程定义 23/23 覆盖</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {EVOLUTION_PHASES.map((phase, index) => <div key={phase.id} className="rounded-2xl border bg-slate-50/60 p-4">
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-indigo-600">阶段 {index + 1}</span><Badge>{phase.range[0]}–{phase.range[1]}</Badge></div>
            <div className="mt-2 font-semibold text-slate-900">{phase.title}</div>
            <div className="mt-2 text-xs leading-5 text-slate-500">输入：{phase.input}<br />产出：{phase.output}</div>
            <div className="mt-3 border-t pt-2 text-[11px] leading-5 text-slate-600">{phase.closedLoopRole}</div>
          </div>)}
        </div>
      </CardContent>
    </Card>}

    {activeTab === "engines" && <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">9 个核心 Engine</h2><p className="mt-1 text-xs text-slate-500">区分“本地已闭环”“真实运行可用”“部分闭环”和“必须等后端”。</p></div><div className="flex flex-wrap gap-2"><div className="flex rounded-xl bg-slate-200/60 p-1"><Button size="sm" variant={engineFilter === "all" ? "default" : "ghost"} onClick={() => setEngineFilter("all")}>全部</Button><Button size="sm" variant={engineFilter === "gaps" ? "default" : "ghost"} onClick={() => setEngineFilter("gaps")}>只看缺口</Button></div><Button size="sm" variant="secondary" onClick={refreshRunner} disabled={runnerCheck.busy}><RefreshCcw className={`size-3.5 ${runnerCheck.busy ? "animate-spin" : ""}`} />刷新 Runner</Button></div></div>
      {runnerCheck.message && <div className="mb-3 rounded-xl border bg-white px-3 py-2 text-xs text-slate-500">{runnerCheck.message}</div>}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {visibleEngines.map((engine) => <Card key={engine.id} className={stateStyles[engine.state]}>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.12em] opacity-70">{engine.purpose}</div><div className="mt-1 font-semibold">{engine.title}</div></div><Badge className="bg-white/70">{stateLabel[engine.state]}</Badge></div>
            <p className="mt-3 text-xs leading-5 opacity-90">{engine.current}</p>
            <div className="mt-3 rounded-xl border border-current/10 bg-white/50 p-2.5 text-[11px] leading-5"><b>还缺：</b>{engine.gap}</div>
          </CardContent>
        </Card>)}
      </div>
      {visibleEngines.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-emerald-700">当前没有需要补齐的 Engine 缺口。</CardContent></Card>}
    </section>}

    {activeTab === "harness" && <HarnessInspector project={latestProject} />}

    {activeTab === "targets" && <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Target Adapter Coverage</h2><p className="mt-1 text-xs text-slate-500">“支持一个对象”必须看完整生命周期，而不是只看能不能读。最终目标统一覆盖 Read → Snapshot → Mutate → Validate → Deploy → Observe → Rollback。</p>{gitCheck.message&&<p className="mt-1 text-[10px] text-slate-400">{gitCheck.message}</p>}</div><Button size="sm" variant="secondary" onClick={refreshGit} disabled={gitCheck.busy}><RefreshCcw className={`size-3.5 ${gitCheck.busy ? "animate-spin" : ""}`} />检测 Git Target</Button></div>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[220px_90px_repeat(7,minmax(84px,1fr))_220px] border-b bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <span>Target</span><span>状态</span><span>Read</span><span>Snapshot</span><span>Mutate</span><span>Validate</span><span>Deploy</span><span>Observe</span><span>Rollback</span><span>主要缺口</span>
              </div>
              {targetCoverage.map((row) => <div key={row.target} className="grid grid-cols-[220px_90px_repeat(7,minmax(84px,1fr))_220px] items-center border-b px-4 py-3 text-xs last:border-b-0">
                <span className="font-semibold text-slate-800">{row.target}</span>
                <Badge className={row.state === "ready" ? "w-fit border-emerald-200 bg-emerald-50 text-emerald-700" : row.state === "partial" ? "w-fit border-amber-200 bg-amber-50 text-amber-700" : "w-fit border-violet-200 bg-violet-50 text-violet-700"}>{row.state === "ready" ? "可用" : row.state === "partial" ? "部分" : "待后端"}</Badge>
                {[row.read,row.snapshot,row.mutate,row.validate,row.deploy,row.observe,row.rollback].map((value,index)=><span key={index} className={value === "✓" || value.includes("Build") || value === "Health" || value === "Canary" || value === "执行证据" ? "font-semibold text-emerald-700" : value.includes("待") ? "text-violet-600" : "text-slate-500"}>{value}</span>)}
                <span className="text-[11px] leading-5 text-slate-500">{row.gap}</span>
              </div>)}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>}

    {activeTab === "overview" && <section>
      <div className="mb-3"><h2 className="font-semibold">现有 Mission 的闭环状态</h2><p className="mt-1 text-xs text-slate-500">直接按 23 个 Workflow Node 计算，不用页面所在阶段猜完成度。</p></div>
      {summaries.length ? <div className="grid gap-3 lg:grid-cols-2">
        {summaries.slice().sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt)).slice(0, 6).map(({ project, loop }) => {
          const steps = deriveWorkflowSteps(project);
          const phaseStates = EVOLUTION_PHASES.map((phase) => {
            const items = steps.filter((step) => Number(step.id) >= phase.range[0] && Number(step.id) <= phase.range[1]);
            const done = items.filter((step) => step.state === "completed" || step.state === "skipped").length;
            return { phase, done, total: items.length };
          });
          return <Card key={project.id}><CardContent className="pt-5">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-semibold">{project.name}</div><div className="mt-1 text-xs text-slate-400">{loop.online ? "需要 Production Outcome" : "离线 Artifact 闭环"} · {loop.closed}/{loop.total} 节点</div></div><Badge className={loop.complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : loop.blocked ? "border-amber-200 bg-amber-50 text-amber-700" : ""}>{loop.complete ? "闭环完成" : `${loop.percent}%`}</Badge></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${loop.percent}%` }} /></div>
            <div className="mt-3 grid grid-cols-4 gap-1">{phaseStates.map(({ phase, done, total }) => <div key={phase.id} title={phase.title} className={`h-2 rounded-full ${done === total ? "bg-emerald-400" : done ? "bg-indigo-300" : "bg-slate-200"}`} />)}</div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-slate-500">下一缺口：{loop.firstOpen?.title ?? "无"}</span><Link to={`/projects/${project.id}`} className="shrink-0 font-semibold text-indigo-600">进入 Mission <ArrowRight className="ml-1 inline size-3" /></Link></div>
          </CardContent></Card>;
        })}
      </div> : <Card><CardContent className="py-12 text-center text-sm text-slate-400">还没有真实 Mission。创建第一个任务后，这里会自动计算 23 节点闭环覆盖率。</CardContent></Card>}
      {summaries.length > 6 && <div className="mt-3 text-right"><Link to="/projects" className="text-xs font-semibold text-indigo-600">查看全部 {summaries.length} 个 Mission <ArrowRight className="ml-1 inline size-3" /></Link></div>}
    </section>}

    {activeTab === "backend" && <section>
      <Card className="mb-4 border-emerald-100 bg-emerald-50/40">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Backend-ready Contract</CardTitle>
              <p className="mt-1 text-xs leading-5 text-slate-500">这表示核心业务已与浏览器实现解耦，可以开始替换为 Postgres / Queue / Worker / Object Storage；不代表这些基础设施已经部署。</p>
            </div>
            <div className="flex gap-2">
              <Badge className="border-emerald-200 bg-white text-emerald-700">{productionContractsReady}/{PRODUCTION_BOUNDARIES.length} Contract</Badge>
              <Badge className={productionMode === "local" ? "border-slate-200 bg-white text-slate-600" : "border-indigo-200 bg-indigo-50 text-indigo-700"}>{productionModeLabel}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">P0-1 · Server Data Foundation</div>
                <div className="mt-1 text-[11px] text-slate-500">{productionMode==="http"
                  ?(backendHealthCheck.message||"等待 Server Data Plane 健康检查")
                  :"开发环境当前使用 Local Adapter；生产构建默认走同源 /api/evolution。"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={dataPlaneReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{dataPlaneReady ? "READY" : "CHECK"}</Badge>
                <Button size="sm" variant="secondary" onClick={refreshBackendHealth} disabled={backendHealthCheck.busy||productionMode!=="http"}><RefreshCcw className={`size-3.5 ${backendHealthCheck.busy ? "animate-spin" : ""}`} />检测 Server</Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-5">
              {(["missions","jobs","events","artifacts"] as const).map((name) => {const ready=backendHealthCheck.health?.dataPlane.tables[name];return <div key={name} className="rounded-lg bg-slate-50 px-2 py-1.5"><b>{name}</b><div className={ready ? "text-emerald-600" : "text-slate-400"}>{ready ? "READY" : "—"}</div></div>;})}
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>storage</b><div className={dataPlaneReady ? "text-emerald-600" : "text-slate-400"}>{dataPlaneReady ? "READY" : "—"}</div></div>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">P0-2 · HTTP Projection + Artifact Remote</div>
                <div className="mt-1 text-[11px] text-slate-500">{productionMode==="http"
                  ?`HTTP projection: ${syncCheck.liveStatus} · Artifact: ${serverDataPlaneReady ? "REMOTE READY" : "WAITING"}`
                  :"Local Adapter 不做远端同步；生产环境通过 Server API 统一读写。"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={p02Ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{p02Ready ? "READY" : "PENDING"}</Badge>
                <Button size="sm" variant="secondary" onClick={refreshBackendHealth} disabled={backendHealthCheck.busy||productionMode!=="http"}><RefreshCcw className={`size-3.5 ${backendHealthCheck.busy ? "animate-spin" : ""}`} />检测 Backend</Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>sync</b><div className={remoteSyncReady ? "text-emerald-600" : "text-slate-400"}>{syncCheck.liveStatus}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>artifact remote</b><div className={dataPlaneReady ? "text-emerald-600" : "text-slate-400"}>{dataPlaneReady ? "READY" : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>local cache</b><div className="text-sky-600">IndexedDB CACHE</div></div>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">P0-3 · Durable Evolution Workflow</div>
                <div className="mt-1 text-[11px] text-slate-500">{workflowCheck.message || "等待 Workflow capability 检测"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={p03FullAuto || p03OfflineAuto ? "border-emerald-200 bg-emerald-50 text-emerald-700" : p03Connected ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}>{p03FullAuto ? "FULL AUTO" : p03OfflineAuto ? "OFFLINE AUTO" : p03Connected ? "PARTIAL" : "CHECK"}</Badge>
                <Button size="sm" variant="secondary" onClick={refreshWorkflow} disabled={workflowCheck.busy}><RefreshCcw className={`size-3.5 ${workflowCheck.busy ? "animate-spin" : ""}`} />检测 Workflow</Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4 xl:grid-cols-12">
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>durable</b><div className={workflowCheck.capabilities?.durable ? "text-emerald-600" : "text-slate-400"}>{workflowCheck.capabilities?.durable ? "READY" : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>server AI</b><div className={workflowCheck.capabilities?.serverAi ? "text-emerald-600" : "text-amber-600"}>{workflowCheck.capabilities?.serverAi ? "READY" : "NOT CONFIGURED"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>server data</b><div className={workflowCheck.capabilities?.backend.dataPlaneConfigured ? "text-emerald-600" : "text-amber-600"}>{workflowCheck.capabilities?.backend.dataPlaneConfigured ? "READY" : "NOT CONFIGURED"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>HTTP API</b><div className={workflowCheck.capabilities?.backend.httpDataPlaneCodeReady ? "text-emerald-600" : "text-slate-400"}>{workflowCheck.capabilities?.backend.httpDataPlaneCodeReady ? "CODE READY" : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>source parse</b><div className={workflowCheck.capabilities?.backend.sourceParseConfigured ? "text-emerald-600" : workflowCheck.capabilities?.backend.sourceParseCodeReady ? "text-amber-600" : "text-slate-400"}>{workflowCheck.capabilities?.backend.sourceParseConfigured ? "READY" : workflowCheck.capabilities?.backend.sourceParseCodeReady ? "CODE READY" : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>server actions</b><div className="text-sky-600">{workflowCheck.capabilities?.serverNativeActions.length ?? 0}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>conditional</b><div className={workflowCheck.capabilities?.conditionalActions.length ? "text-sky-600" : "text-slate-400"}>{workflowCheck.capabilities?.conditionalActions.join(" / ") || "NONE"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>migration</b><div className={workflowCheck.capabilities?.migrationPendingActions.length ? "text-amber-600" : "text-emerald-600"}>{workflowCheck.capabilities?.migrationPendingActions.join(" / ") || "NONE"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>blocked</b><div className={workflowCheck.capabilities?.blockedActions.length ? "text-amber-600" : "text-emerald-600"}>{workflowCheck.capabilities?.blockedActions.map((item)=>item.action).join(" / ") || "NONE"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>offline closure</b><div className={workflowCheck.capabilities?.closure.offlineFullAuto ? "text-emerald-600" : "text-amber-600"}>{workflowCheck.capabilities?.closure.offlineFullAuto ? "FULL AUTO" : workflowCheck.capabilities?.closure.codeReady ? "CODE READY" : "BLOCKED"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>online closure</b><div className={workflowCheck.capabilities?.closure.onlineFullAuto || workflowCheck.capabilities?.closure.onlinePostApprovalAuto ? "text-emerald-600" : "text-amber-600"}>{workflowCheck.capabilities?.closure.onlineFullAuto ? "FULL AUTO" : workflowCheck.capabilities?.closure.onlinePostApprovalAuto ? "POST-APPROVAL AUTO" : workflowCheck.capabilities?.closure.externalCapabilityBlocked.map((item)=>item.capability).join(" / ") || "BLOCKED"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>release recovery</b><div className={workflowCheck.capabilities?.closure.releaseReconciliationReady ? "text-emerald-600" : "text-amber-600"}>{workflowCheck.capabilities?.closure.releaseReconciliationReady ? "READY" : "BLOCKED"}</div></div>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">P0-4 · Vercel Sandbox Runtime</div>
                <div className="mt-1 text-[11px] text-slate-500">{sandboxCheck.message || "尚未执行 Sandbox 健康检查；点击后会创建一个 30 秒临时 Sandbox。"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={p04Ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}>{p04Ready ? "READY" : sandboxCheck.health ? "UNAVAILABLE" : "NOT CHECKED"}</Badge>
                <Button size="sm" variant="secondary" onClick={refreshSandbox} disabled={sandboxCheck.busy}><RefreshCcw className={`size-3.5 ${sandboxCheck.busy ? "animate-spin" : ""}`} />检测 Sandbox</Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>runtime</b><div className={p04Ready ? "text-emerald-600" : "text-slate-400"}>{sandboxCheck.health?.nodeVersion || "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>npm</b><div className={p04Ready ? "text-emerald-600" : "text-slate-400"}>{sandboxCheck.health?.npmVersion || "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>region</b><div className="text-slate-500">{sandboxCheck.health?.region || "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>latency</b><div className="text-slate-500">{sandboxCheck.health?.latencyMs !== undefined ? `${sandboxCheck.health.latencyMs}ms` : "—"}</div></div>
            </div>
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold text-slate-700">Browser Runtime · Chromium + Playwright</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{browserCheck.message || "未检测；首次检测会初始化可复用 Browser Snapshot。"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={p04BrowserReady ? "border-emerald-200 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500"}>{p04BrowserReady ? "READY" : browserCheck.health ? "UNAVAILABLE" : "NOT CHECKED"}</Badge>
                  <Button size="sm" variant="secondary" onClick={refreshBrowser} disabled={browserCheck.busy || !p04Ready}><RefreshCcw className={`size-3.5 ${browserCheck.busy ? "animate-spin" : ""}`} />检测 Browser</Button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-5">
                <div><b>browser</b><div className={p04BrowserReady ? "text-emerald-600" : "text-slate-400"}>{browserCheck.health?.browser || "—"}</div></div>
                <div><b>playwright</b><div className={p04BrowserReady ? "text-emerald-600" : "text-slate-400"}>{browserCheck.health?.playwrightVersion || "—"}</div></div>
                <div><b>snapshot</b><div className={browserCheck.health?.snapshotCached ? "text-emerald-600" : "text-slate-400"}>{browserCheck.health?.snapshotCached ? "CACHED" : "—"}</div></div>
                <div><b>preview</b><div className={browserCheck.health?.previewHealthy ? "text-emerald-600" : "text-slate-400"}>{browserCheck.health?.previewHealthy ? "READY" : "—"}</div></div>
                <div><b>browser steps</b><div className={browserCheck.health?.browserStepsVerified ? "text-emerald-600" : "text-slate-400"}>{browserCheck.health?.browserStepsVerified ? `VERIFIED ${browserCheck.health.browserStepsExecuted}` : "—"}</div></div>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">P0 · Production Release Provider</div>
                <div className="mt-1 text-[11px] text-slate-500">{releaseCheck.message || "等待 Release Provider 检测"}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={releaseWriteReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : releaseReadReady ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}>{releaseWriteReady ? "READ / WRITE READY" : releaseReadReady ? "READ-ONLY READY" : "CHECK"}</Badge>
                <Button size="sm" variant="secondary" onClick={refreshRelease} disabled={releaseCheck.busy}><RefreshCcw className={`size-3.5 ${releaseCheck.busy ? "animate-spin" : ""}`} />检测 Release</Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-5">
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>provider</b><div className={releaseCheck.capabilities?.available ? "text-emerald-600" : "text-slate-400"}>{releaseCheck.capabilities?.available ? "VERCEL" : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>health</b><div className={releaseCheck.health?.ready ? "text-emerald-600" : "text-slate-400"}>{releaseCheck.health?.ready ? "READY" : "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>write</b><div className={releaseCheck.capabilities?.writeEnabled ? "text-emerald-600" : "text-amber-600"}>{releaseCheck.capabilities?.writeEnabled ? "READY" : "TOKEN REQUIRED"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>mode</b><div className="text-sky-600">{releaseCheck.capabilities?.mode === "preview-promote" ? "PREVIEW → PROMOTE" : releaseCheck.capabilities?.mode ?? "—"}</div></div>
              <div className="rounded-lg bg-slate-50 px-2 py-1.5"><b>rolling release</b><div className={releaseCheck.capabilities?.rollingReleaseSupported ? "text-emerald-600" : "text-slate-500"}>{releaseCheck.capabilities?.rollingReleaseSupported ? "SUPPORTED" : releaseCheck.capabilities?.rollingReleaseReason || "NO"}</div></div>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {PRODUCTION_BOUNDARIES.map((item) => <div key={item.id} className="rounded-xl border bg-white p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-800">{item.title}</span><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">READY</Badge></div>
              <div className="mt-1 text-[10px] leading-4 text-slate-400">{item.contract}</div>
            </div>)}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">Production Ports</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">{PRODUCTION_PORTS.map((port) => <div key={port.id} className="rounded-lg bg-slate-50 px-3 py-2 text-[11px]"><b className="text-slate-700">{port.label}</b><div className="mt-0.5 text-slate-400">→ {port.backend}</div></div>)}</div>
            </div>
            <div className="rounded-xl border bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">Schema Versions</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500">
                {Object.entries(PRODUCTION_SCHEMA_VERSIONS).map(([key,value]) => <div key={key} className="flex justify-between gap-2"><span>{key}</span><b className="font-mono text-slate-700">{value}</b></div>)}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2.5 text-[11px] leading-5 text-violet-800"><b>当前优先级：</b>{!serverDataPlaneReady ? "先完成 Server Data Plane 配置与健康检查。" : !p02Ready ? "先完成 HTTP Projection / Artifact Remote 验收。" : !hybridFunctionalReady ? "先完成 P0-4 Vercel Sandbox 真实执行接入。" : !hybridInteractionReady ? "Sandbox Build/Test 已 READY；当前继续完成 Browser Runtime Snapshot、真实 Preview 与 Browser Steps/E2E。" : !releaseReadReady ? "Hybrid 功能闭环已 READY；当前补 Production Release Health 观测。" : !releaseWriteReady ? "Hybrid + Production Health 已 READY；Promote / Rollback 代码已 fail-closed，待后续配置 VERCEL_RELEASE_TOKEN 时再开放写操作。" : !p03FullAuto ? "Hybrid + Production Release Read/Write 已 READY；Server AI / FULL AUTO 仍按既定计划后置。" : "P0-3/P0-4/Production Release 已完整闭环。"}</div>
        </CardContent>
      </Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Backend Readiness Backlog</h2><p className="mt-1 text-xs text-slate-500">默认只看 P0。这里列的是必须配置真实后端/基础设施才能升级证据等级的能力。</p></div><div className="flex flex-wrap gap-2"><div className="flex rounded-xl bg-slate-200/60 p-1">{(["P0","P1","P2","all"] as const).map((priority)=><Button key={priority} size="sm" variant={backendPriority===priority?"default":"ghost"} onClick={()=>setBackendPriority(priority)}>{priority==="all"?"全部":priority}</Button>)}</div><Link to="/settings"><Button variant="secondary" size="sm">AI 模型与连接 <ArrowRight className="size-3.5" /></Button></Link></div></div>
      <div className="space-y-3">
        {(["P0", "P1", "P2"] as const).map((priority) => {
          const items = visibleBackendRequirements.filter((item) => item.priority === priority);
          if (!items.length) return null;
          return <Card key={priority}><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Badge className={priority === "P0" ? "border-rose-200 bg-rose-50 text-rose-700" : priority === "P1" ? "border-amber-200 bg-amber-50 text-amber-700" : ""}>{priority}</Badge>{priority === "P0" ? "闭环关键基础设施" : priority === "P1" ? "生产化与规模化" : "扩展生态"}</CardTitle></CardHeader><CardContent className="grid gap-3 xl:grid-cols-2">
            {items.map((item) => {
              const Icon = backendIcons[item.id as keyof typeof backendIcons] ?? ServerCog;
              const status = backendRequirementState(item, signals);
              return <div key={item.id} className="rounded-2xl border bg-slate-50/60 p-4">
                <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-indigo-600"><Icon className="size-4" /></div><div><div className="font-semibold">{item.title}</div><div className="mt-0.5 text-[10px] text-slate-400">{item.category}</div></div></div><Badge className={status === "ready" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-violet-200 bg-violet-50 text-violet-700"}>{status === "ready" ? "已连接" : "待后端"}</Badge></div>
                <p className="mt-3 text-xs leading-5 text-slate-600">{item.why}</p>
                <div className="mt-3 space-y-2 text-[11px] leading-5">
                  <div><b className="text-slate-700">当前：</b><span className="text-slate-500">{item.current}</span></div>
                  <div><b className="text-slate-700">前端已补齐：</b><span className="text-slate-500">{item.frontend}</span></div>
                  <div><b className="text-slate-700">后端要做：</b><span className="text-slate-500">{item.backend.join(" · ")}</span></div>
                  {item.config?.length ? <div className="rounded-xl bg-white p-2.5"><b className="text-slate-700">后续配置：</b><span className="text-slate-500">{item.config.join(" · ")}</span></div> : null}
                </div>
              </div>;
            })}
          </CardContent></Card>;
        })}
      </div>
    </section>}

    {activeTab === "overview" && <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs leading-6 text-indigo-900">
      <b>完整性的判定标准：</b>一个能力只有在“真实输入 → 实际 Mutation → 真实执行/证据 → Gate 决策 → 同一 Artifact 交付/发布 → Outcome → Learning → Next Queue”全部可追踪时才算闭环。缺少后端时，系统必须明确显示“本地闭环 / 部分闭环 / 待后端”，不能用 Demo 或模拟结果冒充真实能力。
    </div>}
  </div>;
}

function Stat({ label, value, sub, icon, tone = "indigo" }: { label: string; value: string; sub: string; icon: React.ReactNode; tone?: "indigo" | "amber" | "emerald" | "violet" | "slate" }) {
  const styles = {
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    slate: "bg-slate-50 text-slate-700",
  };
  return <Card><CardContent className="flex items-center gap-3 pt-5"><div className={`grid size-10 shrink-0 place-items-center rounded-xl ${styles[tone]}`}>{icon}</div><div><div className="text-2xl font-bold">{value}</div><div className="text-xs font-semibold text-slate-600">{label}</div><div className="mt-0.5 text-[10px] text-slate-400">{sub}</div></div></CardContent></Card>;
}
