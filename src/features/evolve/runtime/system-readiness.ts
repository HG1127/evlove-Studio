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

export type ServerCapabilitySnapshot = {
  controlPlane?: boolean;
  dataPlane?: boolean;
  sourceParse?: boolean;
  artifactStore?: boolean;
  artifactRenderer?: boolean;
  serverAi?: boolean;
  sandbox?: boolean;
  browser?: boolean;
  release?: boolean;
  git?: boolean;
  capabilityService?: boolean;
  capabilitySemantic?: boolean;
  capabilitySharing?: boolean;
  evidenceLedger?: boolean;
  security?: boolean;
  vault?: boolean;
  approvalStore?: boolean;
  connectors?: boolean;
  outcome?: boolean;
};

export type ReadinessSignals = {
  runner?: RunnerCapabilitySnapshot;
  server?: ServerCapabilitySnapshot;
  visualJudgeLive: boolean;
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
  detector?: "control-plane" | "git" | "capability" | "evidence" | "security" | "connectors" | "outcome" | "build" | "release" | "browser" | "visual" | "none";
};

export const BACKEND_REQUIREMENTS: BackendRequirement[] = [
  {
    id: "control-plane",
    priority: "P0",
    title: "Server-side Evolution Control Plane",
    category: "Autonomous Runtime",
    why: "让 Mission 在关闭浏览器后仍能持续执行、调度、续跑和恢复。",
    current: "Durable Workflow、Mission/Job/Event HTTP Data Plane、Artifact Store、Job metadata、取消/恢复与服务端 AI 路由均已落到 Nitro + Supabase/Vercel Workflow；浏览器只保留投影与控制入口。",
    frontend: "前端已切到 Server API Runtime，并可显示 Durable Workflow、Backend Health、Job/Event 与跨刷新恢复状态。",
    backend: ["部署 Supabase migration", "配置 Supabase Service Role / Storage", "配置 Vercel Workflow runtime", "生产环境健康检查与告警"],
    config: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "Vercel Workflow"],
    detector: "control-plane",
  },
  {
    id: "git-target",
    priority: "P0",
    title: "Git-native Target Adapter",
    category: "Target Adapter",
    why: "代码工程需要用 Branch / Commit / PR / Merge 作为真实版本身份，而不是长期依赖 ZIP。",
    current: "GitHub Target 已实现精确 Commit/Tree Snapshot、受控 Branch Mutation、Check Runs、PR、Merge、Webhook 与非 force 的可审计 Rollback；所有写操作绑定 Mission/Candidate 并要求 Repo allowlist。",
    frontend: "Readiness 可从服务端 capability 判断 Git Target 是否真实配置；Candidate、Diff、Lineage、Rollback 与 Commit SHA Evidence 可继续复用现有视图。",
    backend: ["配置 GitHub Token", "配置 Repo allowlist", "配置 Webhook Secret 与 /api/evolution/git-webhook", "生产仓库权限最小化"],
    config: ["EVOLUTION_GITHUB_TOKEN", "EVOLUTION_GITHUB_REPO_ALLOWLIST", "EVOLUTION_GITHUB_WEBHOOK_SECRET"],
    detector: "git",
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
    current: "Release Controller 已实现 Shadow → Canary 5/20/50 → Promote/Rollback 状态机和 Hash Binding；Vercel Durable Workflow 会在 Production 连续证据不足时使用 durable sleep 按时间间隔自动 reconcile，而不是瞬时重复探测伪造健康 streak。",
    frontend: "发布治理、KPI、流量阶段、健康状态、回滚记录、Production Champion 都已呈现。",
    backend: ["Deploy Adapter", "Traffic Controller", "Telemetry Adapter", "Stable/Candidate Deployment Registry", "Release State Store"],
    config: ["RELEASE_DEPLOY_URL", "RELEASE_TRAFFIC_URL", "RELEASE_TELEMETRY_URL", "RELEASE_PLATFORM_TOKEN", "RELEASE_STATE_FILE", "EVOLUTION_PRODUCTION_MONITOR_INTERVAL_SECONDS"],
    detector: "release",
  },
  {
    id: "capability-service",
    priority: "P1",
    title: "Organization Capability Service",
    category: "Learning Runtime",
    why: "让 Lesson/Skill 跨项目、跨用户自动匹配，而不是只存在当前浏览器。",
    current: "Supabase Organization Capability Registry 已实现跨 Mission 同步、Provenance、Replication Evidence、Counter-example；Vercel Production 默认复用 AI Gateway OIDC 的 openai/text-embedding-3-small（1536 维），并通过 pgvector/HNSW RPC 做近邻检索后再与 lexical score hybrid 重排；非 Vercel 环境保留 OpenAI-compatible API Key 回退。",
    frontend: "能力库、经验中心、Next Queue、复用入口已具备；Readiness 按真实 Registry health 与 pgvector RPC 状态区分基础 Registry / 语义匹配。",
    backend: ["部署 organization_capabilities + capability_pgvector migration", "配置 Workspace ID", "Vercel AI Gateway OIDC 或 OpenAI-compatible Embedding Provider", "Organization RBAC/Sharing"],
    config: ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "EVOLUTION_WORKSPACE_ID", "EVOLUTION_AI_GATEWAY_ENABLED（Vercel）", "可选 EVOLUTION_CAPABILITY_EMBEDDING_MODEL/API KEY（非 Vercel 回退）"],
    detector: "capability",
  },
  {
    id: "vault-rbac",
    priority: "P1",
    title: "Vault + RBAC + Approval Policy",
    category: "Governance",
    why: "生产级自主进化不能把 API Key、权限和高风险操作边界只放在浏览器。",
    current: "Server 已实现 trusted signed actor、Viewer/Operator/Approver/Admin/Service RBAC、candidate-bound durable Release Approval grant（TTL/撤销/执行前校验）、AES-256-GCM Server Vault（metadata-only API、active key + historical decrypt key ring、scope 校验）以及 Server Credential Reference。Rollback 保留无审批安全通道。生产数据面要求 Supabase Secret/Service Role。",
    frontend: "浏览器只负责交互；生产 Server API 统一执行权限校验。旧 BYOK localStorage 仍仅属于本地兼容模式，不作为 Server Runtime 的生产凭据来源。",
    backend: ["Trusted Identity Proxy/Header", "AES-256-GCM Server Vault", "RBAC", "Durable Release Approval TTL/Revocation", "Workspace Binding", "后续把 Vault master key 托管到外部 KMS + 细粒度成员目录"],
    config: ["32+ char EVOLUTION_IDENTITY_HMAC_SECRET", "EVOLUTION_WORKSPACE_ID", "SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY", "EVOLUTION_VAULT_MASTER_KEY / KEY_ID / DECRYPT_KEYS_JSON", "EVOLUTION_RELEASE_APPROVAL_TTL_SECONDS", "Provider/Release/Git server secrets"],
    detector: "security",
  },
  {
    id: "evidence-ledger",
    priority: "P1",
    title: "Immutable Evidence Ledger",
    category: "Evidence & Audit",
    why: "需要回答每一次升级为什么发生、用的哪个模型/测试/环境/Artifact，以及证据是否被修改过。",
    current: "Supabase Immutable Evidence Ledger 已实现数据库级 UPDATE/DELETE 阻断、per-Mission 串行 SHA-256 Hash Chain、Server-only HMAC 签名、统一 Event 自动镜像与 Verify API；支持 active signing key + historical verification key ring，密钥轮换后旧账本仍可验证。",
    frontend: "项目内 Evidence/Trace/Gate/Audit/Lineage 保持不变；Readiness 按真实 migration + append function + immutable trigger + signing key health 判定。",
    backend: ["部署 evidence_ledger migration", "配置 active signing key / optional historical verification key ring", "后续 KMS 托管", "Retention/Export Policy", "组织级 RBAC"],
    config: ["SUPABASE_URL", "EVOLUTION_WORKSPACE_ID", "EVOLUTION_EVIDENCE_SIGNING_KEY", "EVOLUTION_EVIDENCE_SIGNING_KEY_ID"],
    detector: "evidence",
  },
  {
    id: "outcome-science",
    priority: "P1",
    title: "Outcome Analytics / Drift / Statistics",
    category: "Outcome Intelligence",
    why: "达到 KPI 门槛不等于真正优于 Stable；长期进化需要统计显著性、分群、漂移和成本/延迟回归。",
    current: "Outcome Warehouse、Stable/Candidate sample ingest、分群比较、近似显著性检验、Candidate 时间漂移和 business/latency/cost/safety regression 已实现；Vercel Release reconcile 会自动把 Stable/Candidate health/latency 旁路写入 Outcome Warehouse，Durable Monitor 会按真实时间间隔持续补样本，小样本保持 insufficient，不伪造显著性。",
    frontend: "Readiness 仅在远端 Outcome Health 确认数据库、ingest、analysis 全部可用时显示 ready；发布页可继续消费分析结果。",
    backend: ["继续接入业务 KPI/cost/safety telemetry source", "定义业务 Metric semantics", "建立更精细 Stable/Control assignment", "持续校准统计方法与多重检验"],
    config: ["EVOLUTION_WORKSPACE_ID", "EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM", "Outcome telemetry source", "Metric Definitions"],
    detector: "outcome",
  },
  {
    id: "connectors",
    priority: "P2",
    title: "External System Connector SDK",
    category: "Target Adapter",
    why: "真实进化对象最终会扩展到 Agent、Workflow、Memory、Database、SaaS、API 和业务系统。",
    current: "Server Connector Registry/SDK 已实现统一 Read/Snapshot/Mutate/Validate/Deploy/Observe/Rollback Contract、allowlisted server manifests、Env 或 AES-GCM Vault credential references、动态权限校验和独立 HMAC Webhook/Event Source。",
    frontend: "Target Adapter Coverage 可读取服务器 Connector capabilities；具体 Agent/Workflow/Memory/API/DB 连接器按 Manifest 生命周期显示 ready/partial。",
    backend: ["配置具体 Connector Manifest", "实现目标系统标准 Lifecycle Endpoint", "配置 credentialEnv 或 credentialVaultId", "配置可选 webhookSecretEnv / webhookSecretVaultId", "按系统补 provider-specific translation"],
    config: ["EVOLUTION_CONNECTORS_JSON", "Manifest 中声明的 Env/Vault credential reference"],
    detector: "connectors",
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

export function deriveEngineReadiness(signals: ReadinessSignals): EngineReadiness[] {
  const runner = signals.runner ?? {};
  const server = signals.server ?? {};
  const browserReady = Boolean((runner.htmlBrowser && runner.screenshots) || server.browser);
  const experimentReady = Boolean((runner.e2e && browserReady) || (server.sandbox && server.browser));
  const buildReady = Boolean(runner.build || server.sandbox);
  const releaseReady = Boolean(runner.release || server.release);
  const visualReady = Boolean(signals.visualJudgeLive && runner.screenshots);
  const artifactReady = Boolean(server.dataPlane && server.artifactStore && server.sourceParse);
  const missionReady = Boolean(server.controlPlane && server.dataPlane);
  return [
    { id: "artifact", title: "Artifact Intelligence", purpose: "理解输入、结构、代码库与文件语义", state: artifactReady ? "ready" : "local", stateLabel: artifactReady ? "服务端闭环" : "本地闭环", current: artifactReady ? "Server Parser Worker / Object Store / Durable Parse Job / Office / PDF / ZIP / Repository Deep Index 已接入" : "Parser Router / Office / PDF / ZIP / Repository Intelligence / AST / Deep Index 已具备", gap: artifactReady ? "继续扩展超大文件、OCR 与增量索引" : "服务端 Parser Worker、Object Store 与跨设备持久化待补" },
    { id: "mission", title: "Mission / Goal Engine", purpose: "把用户目标编译成可执行 Acceptance Contract", state: missionReady ? "ready" : "local", stateLabel: missionReady ? "服务端闭环" : "本地闭环", current: missionReady ? "Mission DB / Durable Workflow / Job/Event Store / Server AI / Cancellation & Recovery 已接入" : "Goal / Scope / Rubric / Eval Suite / Hidden Holdout / Human Gates 已具备", gap: missionReady ? "继续补运维告警、容量与多租户隔离" : "Server-side Mission DB / Scheduler / Worker 待补" },
    { id: "candidate", title: "Hypothesis / Candidate Engine", purpose: "诊断根因、生成多种 Mutation 并搜索 Best-Ever", state: server.git || server.connectors ? "partial" : "local", stateLabel: server.git || server.connectors ? "真实 Target Adapter 已连接" : "本地闭环", current: server.git || server.connectors ? `Diagnosis / Candidate Population / Search Memory / Multi-round Search + ${server.git ? "Git Branch/Commit/PR" : ""}${server.git&&server.connectors ? " + " : ""}${server.connectors ? "External Connector Lifecycle" : ""} 已具备` : "Diagnosis / Candidate Population / Search Memory / Multi-round Search 已具备", gap: server.git || server.connectors ? "继续增加具体业务系统 Connector Manifest / provider translation，不再缺统一 Target Contract" : "配置 Git 或 External Connector Target 后启用真实对象 Mutation" },
    { id: "experiment", title: "Experiment Engine", purpose: "让 Candidate 在真实环境执行并与 Baseline 同卷比较", state: buildReady && experimentReady ? "ready" : experimentReady ? "partial" : "backend", stateLabel: buildReady && experimentReady ? "真实可用" : experimentReady ? "HTML/E2E 可用" : "需后端", current: `Browser ${browserReady ? "READY" : "MISSING"} · E2E ${(runner.e2e||server.browser&&server.sandbox) ? "READY" : "MISSING"} · Build/Sandbox ${buildReady ? "READY" : "MISSING"}`, gap: buildReady ? "核心 Sandbox/Preview 已闭环；后续按目标工程扩展更多 Runtime Image/资源策略" : "需 Build / Sandbox / Preview Runtime" },
    { id: "evidence", title: "Evidence Engine", purpose: "绑定 Claim → Evidence → Artifact → Test → Decision", state: server.evidenceLedger || browserReady || server.artifactStore ? "partial" : "local", stateLabel: server.evidenceLedger ? "不可变账本已连接" : browserReady || server.artifactStore ? "真实证据可用" : "本地证据", current: `Artifact Store ${server.artifactStore ? "SERVER" : "LOCAL"} · Immutable Ledger ${server.evidenceLedger ? "SIGNED+CHAINED+ROTATABLE" : "MISSING"} · Browser Evidence ${browserReady ? "已接入" : "待接入"} · Visual Judge ${visualReady ? "LIVE" : "未完全就绪"}`, gap: server.evidenceLedger ? "核心 Append-only/Hash Chain/HMAC/历史密钥验签已闭环；后续可接 KMS、Retention/Export 策略" : "部署 append-only / signed Immutable Evidence Ledger migration + server signing key" },
    { id: "artifact-engineering", title: "Artifact Engineering", purpose: "把通过验收的同一 Candidate 物化为真实可用成果", state: server.artifactRenderer ? "ready" : server.git ? "partial" : "partial", stateLabel: server.artifactRenderer ? server.git ? "Server Renderer + Git 写回" : "Server Renderer 已连接" : server.git ? "Git 写回已连接" : "浏览器多格式可用", current: server.artifactRenderer ? `Gate F Frozen Candidate → Server Artifact Store 已支持 Text/HTML/JSON、DOCX/PPTX OOXML、Spreadsheet、ZIP/Code package 同格式物化、重开结构校验与 SHA-256 回执${server.git ? "；文本/代码成果还可原生写回 Git Branch/Commit/PR" : ""}` : server.git ? "Gate F 文本/代码成果可写回 Git；Office 二进制 Server Renderer 尚未连接" : "浏览器 Text/HTML/JSON、DOCX、PPTX、Spreadsheet、ZIP Roundtrip 与结构校验已具备", gap: server.artifactRenderer ? "PDF/图片/设计类等不可逆格式继续保持 external-required；Office 最终视觉/公式重算由专用验证器补强" : "Server Artifact Store + Renderer 未连接；当前正式二进制交付仍依赖浏览器本地物化" },
    { id: "release", title: "Release / Outcome Engine", purpose: "Shadow / Canary / Promote / Rollback 并观测真实 Outcome", state: releaseReady ? "ready" : "backend", stateLabel: releaseReady ? "生产能力已连接" : "需生产后端", current: releaseReady ? "真实 Release Controller + Reconcile + 自动 Stable/Candidate Outcome 采样 + Drift/Statistics 已就绪" : "Release 状态机、Reconcile、Outcome Warehouse/Statistics 代码已具备；等待生产发布写凭据", gap: releaseReady ? "核心 Production Outcome Loop 已闭环；后续继续丰富业务 KPI/cost/safety telemetry" : "配置真实发布平台写凭据后即可启用 Deploy/Promote/Rollback" },
    { id: "learning", title: "Learning / Capability Engine", purpose: "把结果沉淀为 Lesson / Skill / Anti-pattern / Next Queue", state: "partial", stateLabel: server.capabilitySemantic && server.capabilitySharing ? "组织级语义 Registry + Sharing/RBAC" : server.capabilitySemantic ? "组织级语义 Registry 已连接" : server.capabilityService ? "组织级 Registry 已连接" : "项目级闭环", current: server.capabilityService ? `经验提炼、Skill Provenance、Production Governance、Lifecycle History、Supersession、跨 Mission Registry/Replication/Counter-example 已接入${server.capabilitySemantic ? "；Vercel OIDC/API Key Embedding + pgvector/HNSW + lexical hybrid ranking 已启用" : ""}${server.capabilitySharing ? "；private/workspace/restricted Sharing + Owner/Role RBAC 已启用" : ""}` : "经验提炼、Skill Provenance、Production Governance、Lifecycle History、Supersession 与 Next Queue 已具备", gap: server.capabilitySemantic && server.capabilitySharing ? "核心跨项目语义检索与 Sharing/RBAC 已闭环；后续主要是多组织成员目录与跨 workspace federation" : server.capabilitySemantic ? "部署 Capability Sharing/RBAC migration 后启用 Owner/Role 访问策略" : server.capabilityService ? "Vercel 上确认 AI Gateway OIDC；非 Vercel 可配置 Embedding Provider。pgvector migration 已具备，无向量时自动 lexical fallback" : "部署 Organization Capability Registry 后启用跨项目复用" },
    { id: "governance", title: "Governance Engine", purpose: "控制风险、权限、审批、审计与秘密", state: "partial", stateLabel: server.security && server.vault && server.approvalStore ? "RBAC + Encrypted Vault + Durable Approval" : server.security ? "Server RBAC 已强制" : "规则已具备", current: server.security ? `Trusted signed actor / Workspace binding / RBAC / candidate-bound Release Approval TTL+Revocation / Server Credential Reference + Immutable Ledger 已进入生产后端${server.vault ? "；AES-256-GCM Server Vault + key rotation 已连接" : ""}${server.approvalStore ? "；durable approval store 已连接" : ""}` : "Autonomy Policy / Human Gate / Audit / Rollback 规则已具备", gap: server.security && server.vault && server.approvalStore ? "核心 Vault/RBAC/Approval 已闭环；后续可替换/托管 master key 到外部 KMS，并扩展细粒度组织成员目录" : server.security ? "配置 Server Vault master key / database migration 与 durable approval store；外部 KMS、细粒度组织成员目录后续补强" : "Server Identity / RBAC / Credential Reference / Approval Policy 待补" },
  ];
}

export function backendRequirementState(requirement: BackendRequirement, signals: ReadinessSignals) {
  const runner = signals.runner ?? {};
  const server = signals.server ?? {};
  if (requirement.detector === "control-plane") return server.controlPlane && server.dataPlane ? "ready" as const : "missing" as const;
  if (requirement.detector === "git") return server.git ? "ready" as const : "missing" as const;
  if (requirement.detector === "capability") return server.capabilityService ? "ready" as const : "missing" as const;
  if (requirement.detector === "evidence") return server.evidenceLedger ? "ready" as const : "missing" as const;
  if (requirement.detector === "security") return server.security ? "ready" as const : "missing" as const;
  if (requirement.detector === "connectors") return server.connectors ? "ready" as const : "missing" as const;
  if (requirement.detector === "outcome") return server.outcome ? "ready" as const : "missing" as const;
  if (requirement.detector === "build") return runner.build || server.sandbox ? "ready" as const : "missing" as const;
  if (requirement.detector === "release") return runner.release || server.release ? "ready" as const : "missing" as const;
  if (requirement.detector === "browser") return (runner.htmlBrowser && runner.e2e) || server.browser ? "ready" as const : "missing" as const;
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
