// 节点运行的「存活登记处」：让运行状态不随界面切换 / 页面刷新而丢失。
// 两层记录：
// 1. LIVE（内存）：运行中的状态镜像。项目界面退出再进入时，新挂载的界面直接接上
//    仍在跑的任务状态（后台任务本身不会因组件卸载而停止，数据也持续写入本地存储）。
// 2. TASK（本地存储 + 心跳）：运行任务登记。页面刷新后内存全丢，但登记还在——
//    重新进入项目时据此自动续跑（多轮编排从检查点继续，单节点动作重新执行）。
//    刷新/关闭页面瞬间把登记标记为 interrupted，续跑无需等心跳过期。

export type RuntimeStatus = {
  busy: boolean;
  label?: string;
  error?: string;
  message?: string;
  phase?: string;
  detail?: string;
  done?: number;
  total?: number;
  percent?: number;
  startedAt?: string;
  elapsedSeconds?: number;
  etaSeconds?: number;
  provider?: string;
  model?: string;
  /** 实际正在执行的 AI 节点；项目页据此让模型选择与进度展示对齐。 */
  operation?: AiOperation;
};

export type RunTaskKind = "campaign" | "action";

export type RunTaskRecord = {
  projectId: string;
  kind: RunTaskKind;
  /** kind=action 时对应工作流动作 id（eval-suite / baseline / plan …），续跑时按它重新执行。 */
  actionId?: string;
  label: string;
  startedAt: string;
  heartbeatAt: string;
  /** 页面刷新/关闭时置真：重新进入应立即续跑，不必等心跳过期。 */
  interrupted?: boolean;
  progress?: Omit<RuntimeStatus, "busy">;
};

const TASKS_KEY = "evolve-studio:run-tasks:v1";
const AUTO_GATE_KEY = "evolve-studio:run-auto-gate:v1";
/** 心跳超过该时长视为运行方已消失（崩溃/被杀），允许另一处续跑；正常刷新走 interrupted 立即续跑。 */
const STALE_MS = 45_000;
const HEARTBEAT_MS = 10_000;
export const RUN_HEARTBEAT_INTERVAL_MS = HEARTBEAT_MS;

// ---------- LIVE：内存中的运行状态镜像（跨界面切换存活） ----------

const LIVE = new Map<string, RuntimeStatus>();
const liveListeners = new Set<() => void>();

function notifyLive() {
  for (const listener of liveListeners) listener();
}

/** 订阅运行状态变化（任何项目的发布都会触发；订阅方自行按 projectId 取用）。 */
export function subscribeLiveRuns(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => { liveListeners.delete(listener); };
}

/** 取最近一次发布的状态（可能 busy=false 的收尾状态）；没有则 undefined。 */
export function getLiveStatus(projectId: string): RuntimeStatus | undefined {
  return LIVE.get(projectId);
}

/** 只认「正在运行中」的状态：用于挂载时接管与防重复启动判断。 */
export function getLiveRun(projectId: string): RuntimeStatus | undefined {
  const status = LIVE.get(projectId);
  return status?.busy ? status : undefined;
}

export function publishLiveStatus(projectId: string, status: RuntimeStatus) {
  LIVE.set(projectId, status);
  notifyLive();
}

// ---------- TASK：本地存储中的运行任务登记（跨刷新存活） ----------

function readTasks(): Record<string, RunTaskRecord> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(TASKS_KEY) ?? "{}") as Record<string, RunTaskRecord>;
  } catch {
    return {};
  }
}

function writeTasks(tasks: Record<string, RunTaskRecord>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  window.dispatchEvent(new CustomEvent("evolve-run-tasks-changed"));
}

export function getRunTask(projectId: string): RunTaskRecord | undefined {
  return readTasks()[projectId];
}

export function listRunTasks(): RunTaskRecord[] {
  return Object.values(readTasks());
}

export function getTaskRuntimeStatus(projectId: string): RuntimeStatus | undefined {
  const task = getRunTask(projectId);
  if (!task) return undefined;
  return { busy: true, label: task.progress?.label ?? task.label, startedAt: task.startedAt, ...task.progress };
}

export function updateRunTaskProgress(projectId: string, status: RuntimeStatus) {
  const tasks = readTasks(); const task = tasks[projectId]; if (!task) return;
  const progress=Object.fromEntries(
    Object.entries(status).filter(([key])=>key!=="busy"),
  ) as Omit<RuntimeStatus,"busy">;
  tasks[projectId] = { ...task, progress, heartbeatAt: new Date().toISOString(), interrupted: false };
  writeTasks(tasks);
}

export function beginRunTask(projectId: string, task: { kind: RunTaskKind; actionId?: string; label: string }) {
  const tasks = readTasks();
  const startedAt = new Date().toISOString();
  tasks[projectId] = { projectId, kind: task.kind, actionId: task.actionId, label: task.label, startedAt, heartbeatAt: startedAt };
  writeTasks(tasks);
}

export function heartbeatRunTask(projectId: string) {
  const tasks = readTasks();
  const task = tasks[projectId];
  if (!task) return;
  tasks[projectId] = { ...task, heartbeatAt: new Date().toISOString(), interrupted: false };
  writeTasks(tasks);
}

export function endRunTask(projectId: string) {
  const tasks = readTasks();
  if (!(projectId in tasks)) return;
  delete tasks[projectId];
  writeTasks(tasks);
}

/** 刷新/关闭瞬间把所有未完成登记标记为 interrupted：重进时立即续跑，不等心跳过期。 */
export function markAllTasksInterrupted() {
  const tasks = readTasks();
  let changed = false;
  for (const [id, task] of Object.entries(tasks)) {
    if (!task.interrupted) { tasks[id] = { ...task, interrupted: true }; changed = true; }
  }
  if (changed) writeTasks(tasks);
}

/** 该登记是否应续跑：明确被打断，或心跳已过期（运行方消失）。仍在新鲜心跳内的登记说明别处正在跑，不动它。 */
export function shouldResumeTask(task: RunTaskRecord, nowMs = Date.now()): boolean {
  if (task.interrupted) return true;
  const heartbeat = new Date(task.heartbeatAt).getTime();
  return Number.isFinite(heartbeat) && nowMs - heartbeat > STALE_MS;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", markAllTasksInterrupted);
}

// ---------- 「自动运行到下个 Gate」开关：跨切换/刷新保留，续跑后自动链继续 ----------

function readAutoFlags(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(AUTO_GATE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function getAutoGateFlag(projectId: string): boolean {
  return readAutoFlags()[projectId] === true;
}

export function setAutoGateFlag(projectId: string, enabled: boolean) {
  if (typeof window === "undefined") return;
  const flags = readAutoFlags();
  if (enabled) flags[projectId] = true;
  else delete flags[projectId];
  window.localStorage.setItem(AUTO_GATE_KEY, JSON.stringify(flags));
}
import type { AiOperation } from "../ai/schemas";
