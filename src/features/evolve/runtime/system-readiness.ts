import type { EvolveProject } from "../schemas";
import { deriveWorkflowSteps, workflowRequiresOnlineRelease } from "./workflow-engine";

export type ReadinessState = "ready" | "local" | "partial" | "backend" | "blocked";

export type RunnerCapabilitySnapshot = {
  syntax?: boolean;
  htmlBrowser?: boolean;
  screenshots?: boolean;
  build?: boolean;
  e2e?: boolean;
  release?: boolean;
};

export const EVOLUTION_PHASES = [
  { id: "target", title: "目标与契约", range: [1, 3] as const, input: "完整材料 + 原始要求", output: "Goal / Protected Scope / Acceptance Rubric", closedLoopRole: "定义可机器执行的目标函数" },
  { id: "baseline", title: "原版基线", range: [4, 5] as const, input: "冻结后的目标 + 原版", output: "Baseline Runs / Trace / Evidence", closedLoopRole: "知道当前版本真实表现" },
  { id: "diagnose", title: "问题与根因", range: [6, 10] as const, input: "Baseline Evidence", output: "Failure Map / Root Cause / Mutation Hypotheses", closedLoopRole: "把失败转成可证伪假设" },
  { id: "experiment", title: "候选与实验", range: [11, 13] as const, input: "Hypothesis + Source", output: "Candidate Artifacts / Same-test Comparison", closedLoopRole: "生成并比较真实新版" },
  { id: "holdout", title: "盲测验证", range: [14, 15] as const, input: "Finalist Candidate", output: "Hidden Validation / Offline Winner", closedLoopRole: "防止只在已知测试上过拟合" },
  { id: "acceptance", title: "成果验收与交付", range: [16, 18] as const, input: "Winner Snapshot + Rubric", output: "Repair Loop / Frozen Deliverable", closedLoopRole: "保证交付物就是验收过的同一版本" },
  { id: "production", title: "生产 Outcome", range: [19, 21] as const, input: "Frozen Champion", output: "Shadow / Canary / Promote or Rollback", closedLoopRole: "用真实生产结果决定是否升级" },
  { id: "learning", title: "学习与下一轮", range: [22, 23] as const, input: "Offline + Production Evidence", output: "Lesson / Skill / Anti-pattern / Next Queue", closedLoopRole: "把结果转成下一轮可复用能力" },
] as const;

export type BackendRequirement = {
  id: string;
  priority: "P0" | "P1" | "P2";
  title: string;
  category: string;
  why: string;
  current: string;
  frontend: string;
  backend: string[];
  config?: string[];
  detector?: "build" | "release" | "browser" | "visual" | "none";
};

export const BACKEND_REQUIREMENTS: BackendRequirement[] = [
  {
    id: "control-plane",
    priority: "P0",
    title: "Server-side Evolution Control Plane",
    category: "Autonomous Runtime",
    why: "让 Mission 在关闭浏览器后仍能持续执行、调度、续跑和恢复。",
    current: "Evolution Harness v1 + Action Executor 已收口；Mission/Job/Event/Artifact Port、统一 Job Contract、Target Lifecycle Contract 与 Versioned Schema v1 已完成，本地与 HTTP Adapter 均已具备。执行主体当前仍在浏览器。",
    frontend: "Backend-ready Contract 6/6 已完成；前端可在 local/remote Runtime 间切换，并保留 Mission 本地投影、Artifact 远端回读、统一 Job 镜像与 Event Contract。",
    backend: ["Mission DB", "Persistent Job Queue", "Worker Pool", "Scheduler", "Lease / Heartbeat", "Cancellation", "Event Stream / SSE/WebSocket"],
    config: ["VITE_EVOLUTION_API_URL", "Postgres", "Queue / Worker", "Object Storage", "SSE / WebSocket"],
    detector: "none",
  },
  {
    id: "git-target",
    priority: "P0",
    title: "Git-native Target Adapter",
    category: "Target Adapter",
    why: "代码工程需要用 Branch / Commit / PR / Merge 作为真实版本身份，而不是长期依赖 ZIP。",
    current: "ZIP 工程可解析、修改、重打包、做 AST/Dependency，但没有真实 Git 生命周期。",
    frontend: "前端已具备 Candidate、版本、Diff、Lineage、Rollback、Artifact Hash 等呈现。",
    backend: ["SCM OAuth", "Clone/Fetch", "Branch", "Commit", "PR", "Merge", "Webhook", "Commit SHA Evidence"],
    config: ["GitHub/GitLab App 或 OAuth", "SCM webhook secret", "Repo allowlist"],
    detector: "none",
  },
  {
    id: "sandbox",
    priority: "P0",
    title: "Build / Sandbox / Preview Runtime",
    category: "Experiment Runtime",
    why: "完整代码进化必须经过真实 Build、Test、启动服务、Preview URL 和 E2E，而不仅是静态源码检查。",
    current: "Runner 已支持安全 Docker Build 入口；HTML Browser/E2E 已可运行。",
    frontend: "前端已显示 Build/E2E/Evidence Job 状态，并能区分 VERIFIED/PARTIAL/UNVERIFIED。",
    backend: ["Runtime Image Registry", "Ephemeral Sandbox", "Build/Test", "Start Service", "Preview URL", "Resource Quota", "Network Policy", "Artifact Export"],
    config: ["BUILD_IMAGE", "BUILD_COMMAND", "可选 Node/Python/Java/Go Runtime Images"],
    detector: "build",
  },
  {
    id: "release",
    priority: "P0",
    title: "Production Deploy / Traffic / Telemetry",
    category: "Outcome Runtime",
    why: "只有接入真实部署、切流与生产指标，系统才形成真正 Production Outcome Loop。",
    current: "Release Controller 已实现 Shadow → Canary 5/20/50 → Promote/Rollback 状态机和 Hash Binding。",
    frontend: "发布治理、KPI、流量阶段、健康状态、回滚记录、Production Champion 都已呈现。",
    backend: ["Deploy Adapter", "Traffic Controller", "Telemetry Adapter", "Stable/Candidate Deployment Registry", "Release State Store"],
    config: ["RELEASE_DEPLOY_URL", "RELEASE_TRAFFIC_URL", "RELEASE_TELEMETRY_URL", "RELEASE_PLATFORM_TOKEN", "RELEASE_STATE_FILE"],
    detector: "release",
  },
  {
    id: "capability-service",
    priority: "P1",
    title: "Organization Capability Service",
    category: "Learning Runtime",
    why: "让 Lesson/Skill 跨项目、跨用户自动匹配，而不是只存在当前浏览器。",
    current: "能力库已有 Verified Skill / Lesson / Anti-pattern / Recipe，但主要来自本地项目与手动 Skill Seed。",
    frontend: "能力库、经验中心、Next Queue、复用入口已具备。",
    backend: ["Capability Registry", "Vector Search", "Semantic Matching", "Replication Evidence", "Counter-example Store", "Organization Sharing"],
    config: ["CAPABILITY_API_URL", "Vector DB", "Organization/Workspace ID"],
    detector: "none",
  },
  {
    id: "vault-rbac",
    priority: "P1",
    title: "Vault + RBAC + Approval Policy",
    category: "Governance",
    why: "生产级自主进化不能把 API Key、权限和高风险操作边界只放在浏览器。",
    current: "已有 Autonomy Policy、Human Gate、AI Audit；BYOK 密钥仍主要在浏览器 localStorage。",
    frontend: "前端已区分机器动作、人类 Gate、发布确认和审计留痕。",
    backend: ["Secrets Vault", "Credential Reference", "RBAC", "Environment Permission", "Approval Policy", "Service Identity"],
    config: ["VAULT/KMS", "Auth Provider", "Role Mapping", "Approval Policy Service"],
    detector: "none",
  },
  {
    id: "evidence-ledger",
    priority: "P1",
    title: "Immutable Evidence Ledger",
    category: "Evidence & Audit",
    why: "需要回答每一次升级为什么发生、用的哪个模型/测试/环境/Artifact，以及证据是否被修改过。",
    current: "已有 Artifact Hash、Trace、AI Audit、Release History，但持久化主要是浏览器/本地文件。",
    frontend: "项目内已有 Evidence、Trace、Gate、Audit、Lineage 视图。",
    backend: ["Append-only Ledger", "Artifact/Object Store", "Signed Hash", "Prompt/Test Version", "Actor/Decision Record", "Retention Policy"],
    config: ["EVIDENCE_LEDGER_URL", "Object Storage", "Signing Key/KMS"],
    detector: "none",
  },
  {
    id: "outcome-science",
    priority: "P1",
    title: "Outcome Analytics / Drift / Statistics",
    category: "Outcome Intelligence",
    why: "达到 KPI 门槛不等于真正优于 Stable；长期进化需要统计显著性、分群、漂移和成本/延迟回归。",
    current: "Release Controller 已支持 KPI、样本量、观察窗口与自动回滚。",
    frontend: "发布页已有 KPI、健康状态和 Release Audit Trail。",
    backend: ["Control Group", "Statistical Test", "Segment Analysis", "Drift Detection", "Cost/Latency/Safety Regression", "Outcome Warehouse"],
    config: ["Analytics/Warehouse", "Metric Definitions", "Experiment Assignment"],
    detector: "release",
  },
  {
    id: "connectors",
    priority: "P2",
    title: "External System Connector SDK",
    category: "Target Adapter",
    why: "真实进化对象最终会扩展到 Agent、Workflow、Memory、Database、SaaS、API 和业务系统。",
    current: "当前 Target Adapter 主要是 artifact / http / mock；tool、memory、model 仍可能只是 runtime mutation。",
    frontend: "前端 Candidate、Mutation Scope、Evidence 和治理模型已能承接更多 Adapter。",
    backend: ["Connector SDK", "Read/Snapshot/Mutate/Validate/Deploy/Observe/Rollback Contract", "Webhook/Event Source"],
    config: ["各业务系统 OAuth/API Credentials", "Connector Registry"],
    detector: "none",
  },
];

export type EngineReadiness = {
  id: string;
  title: string;
  purpose: string;
  state: ReadinessState;
  stateLabel: string;
  current: string;
  gap: string;
};

export function deriveEngineReadiness(signals: {
  runner?: RunnerCapabilitySnapshot;
  visualJudgeLive: boolean;
}): EngineReadiness[] {
  const runner = signals.runner ?? {};
  const browserReady = Boolean(runner.htmlBrowser && runner.screenshots);
  const experimentReady = Boolean(runner.e2e && browserReady);
  const buildReady = Boolean(runner.build);
  const releaseReady = Boolean(runner.release);
  const visualReady = Boolean(signals.visualJudgeLive && runner.screenshots);
  return [
    { id: "artifact", title: "Artifact Intelligence", purpose: "理解输入、结构、代码库与文件语义", state: "local", stateLabel: "本地闭环", current: "Parser Router / Office / PDF / ZIP / Repository Intelligence / AST / Deep Index 已具备", gap: "服务端 Parser Worker、Object Store 与跨设备持久化待补" },
    { id: "mission", title: "Mission / Goal Engine", purpose: "把用户目标编译成可执行 Acceptance Contract", state: "local", stateLabel: "本地闭环", current: "Goal / Scope / Rubric / Eval Suite / Hidden Holdout / Human Gates 已具备", gap: "Server-side Mission DB / Scheduler / Worker 待补" },
    { id: "candidate", title: "Hypothesis / Candidate Engine", purpose: "诊断根因、生成多种 Mutation 并搜索 Best-Ever", state: "local", stateLabel: "本地闭环", current: "Diagnosis / Candidate Population / Search Memory / Multi-round Search 已具备", gap: "Git / Agent / Workflow / Memory 等真实 Target Adapter 待补" },
    { id: "experiment", title: "Experiment Engine", purpose: "让 Candidate 在真实环境执行并与 Baseline 同卷比较", state: buildReady && experimentReady ? "ready" : experimentReady ? "partial" : "backend", stateLabel: buildReady && experimentReady ? "真实可用" : experimentReady ? "HTML/E2E 可用" : "需后端", current: `Browser ${browserReady ? "READY" : "MISSING"} · E2E ${runner.e2e ? "READY" : "MISSING"} · Build ${buildReady ? "READY" : "MISSING"}`, gap: buildReady ? "代码 Sandbox/Preview 仍可继续扩展多语言 Runtime" : "需 BUILD_IMAGE / Sandbox / Preview Runtime" },
    { id: "evidence", title: "Evidence Engine", purpose: "绑定 Claim → Evidence → Artifact → Test → Decision", state: browserReady ? "partial" : "local", stateLabel: browserReady ? "真实证据可用" : "本地证据", current: `Static / Hash / Trace / Browser Evidence ${browserReady ? "已接入" : "待接入"} · Visual Judge ${visualReady ? "LIVE" : "未完全就绪"}`, gap: "Immutable Evidence Ledger 与服务端 Artifact/Evidence Store 待补" },
    { id: "artifact-engineering", title: "Artifact Engineering", purpose: "把通过验收的同一 Candidate 物化为真实可用成果", state: "partial", stateLabel: "多格式可用", current: "Text/HTML/JSON、DOCX、PPTX、Spreadsheet、ZIP Roundtrip 与结构校验已具备", gap: "Git 原生写回、复杂 Office Renderer、PDF/设计类 Renderer 待补" },
    { id: "release", title: "Release / Outcome Engine", purpose: "Shadow / Canary / Promote / Rollback 并观测真实 Outcome", state: releaseReady ? "ready" : "backend", stateLabel: releaseReady ? "生产能力已连接" : "需生产后端", current: releaseReady ? "真实 Release Controller capability 已就绪" : "前端与 Release Controller 状态机已具备，但生产 Deploy/Traffic/Telemetry 未连接", gap: releaseReady ? "继续补统计与漂移能力" : "需配置真实发布平台 3 个端点与服务端状态存储" },
    { id: "learning", title: "Learning / Capability Engine", purpose: "把结果沉淀为 Lesson / Skill / Anti-pattern / Next Queue", state: "partial", stateLabel: "项目级闭环", current: "经验提炼、能力库、Next Queue、离线证据降级规则已具备", gap: "组织级 Capability Service、语义匹配、跨项目复验与反例库待补" },
    { id: "governance", title: "Governance Engine", purpose: "控制风险、权限、审批、审计与秘密", state: "partial", stateLabel: "规则已具备", current: "Autonomy Policy / Human Gate / Audit / Rollback 规则已具备", gap: "Vault / RBAC / Policy Service / Immutable Audit 待补" },
  ];
}

export function backendRequirementState(requirement: BackendRequirement, signals: { runner?: RunnerCapabilitySnapshot; visualJudgeLive: boolean }) {
  const runner = signals.runner ?? {};
  if (requirement.detector === "build") return runner.build ? "ready" as const : "missing" as const;
  if (requirement.detector === "release") return runner.release ? "ready" as const : "missing" as const;
  if (requirement.detector === "browser") return runner.htmlBrowser && runner.e2e ? "ready" as const : "missing" as const;
  if (requirement.detector === "visual") return signals.visualJudgeLive ? "ready" as const : "missing" as const;
  return "missing" as const;
}

export function projectLoopSummary(project: EvolveProject) {
  const steps = deriveWorkflowSteps(project);
  const closed = steps.filter((step) => step.state === "completed" || step.state === "skipped").length;
  const blocked = steps.filter((step) => step.state === "blocked").length;
  const running = steps.filter((step) => step.state === "running" || step.state === "ready").length;
  const online = workflowRequiresOnlineRelease(project);
  const complete = closed === steps.length;
  const firstOpen = steps.find((step) => !["completed", "skipped"].includes(step.state));
  return {
    total: steps.length,
    closed,
    blocked,
    running,
    online,
    complete,
    percent: Math.round(closed / Math.max(1, steps.length) * 100),
    firstOpen,
  };
}
