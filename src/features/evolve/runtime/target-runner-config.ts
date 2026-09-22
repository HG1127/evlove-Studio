// 真实 Target Runner（HTTP Target Gateway）运行时配置。
// 原 Next 版靠服务端环境变量；浏览器端改为设置页可配置并持久化到 localStorage。
// 内置 Runner 随应用 HTTP 服务加载，无需单独启动进程或配置端口。
import { TargetProxyCapabilitiesSchema, type EvolveProject, type TargetProxyCapabilities } from "../schemas";

export type RunnerGatewayConfig = {
  enabled: boolean;
  label: string;
  runUrl: string;
  releaseUrl: string;
  timeoutMs: number;
};

const KEY = "evolve-studio:target-runner:v1";
const DETACH_PREFIX = "evolve-studio:runner-detached:";
export const RUNNER_GATEWAY_EVENT = "evolve-runner-gateway-changed";

const CUSTOM_DEFAULT: RunnerGatewayConfig = {
  enabled: true,
  label: "Server Target Proxy",
  runUrl: "/api/evolution/target-run",
  releaseUrl: "/api/evolution/target-release",
  timeoutMs: 90000,
};

/** 浏览器只连接同源 Server Target Proxy；真实外部 URL / Token 仅存在服务器环境变量。 */
export function builtinRunnerGateway(): RunnerGatewayConfig {
  return { ...CUSTOM_DEFAULT };
}

export function isBuiltinRunnerGateway(config: RunnerGatewayConfig): boolean {
  return config.runUrl === "/api/evolution/target-run";
}

export function resetRunnerGatewayConfig(): RunnerGatewayConfig {
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem("evolve-runner-capabilities");
  window.dispatchEvent(new CustomEvent(RUNNER_GATEWAY_EVENT));
  return builtinRunnerGateway();
}

export function hasSavedRunnerConfig(): boolean {
  try { return Boolean(window.localStorage.getItem(KEY)); } catch { return false; }
}

export function getRunnerGatewayConfig(): RunnerGatewayConfig {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const legacy = JSON.parse(raw) as Partial<RunnerGatewayConfig> & {bearerToken?:string};
      return { ...builtinRunnerGateway(), enabled: legacy.enabled ?? true, label: legacy.label?.trim() || "Server Target Proxy", timeoutMs: legacy.timeoutMs ?? 90000 };
    }
  } catch { /* 落盘损坏时回落到内置网关 */ }
  return builtinRunnerGateway();
}

export function saveRunnerGatewayConfig(config: RunnerGatewayConfig) {
  window.localStorage.setItem(KEY, JSON.stringify({
    enabled:config.enabled,
    label:config.label,
    runUrl:"/api/evolution/target-run",
    releaseUrl:"/api/evolution/target-release",
    timeoutMs:config.timeoutMs,
  }));
  window.dispatchEvent(new CustomEvent(RUNNER_GATEWAY_EVENT));
}

export function isRunnerGatewayReady(config: RunnerGatewayConfig = getRunnerGatewayConfig()): boolean {
  return config.enabled && Boolean(config.runUrl.trim());
}

export async function getTargetProxyCapabilities(timeoutMs=40000):Promise<TargetProxyCapabilities>{
  const res=await fetch("/api/evolution/target-capabilities",{
    signal:AbortSignal.timeout(Math.max(3000,Math.min(timeoutMs,40000))),
  });
  if(!res.ok)throw new Error(`Server Target Proxy 不可用（HTTP ${res.status}）`);
  return TargetProxyCapabilitiesSchema.parse(await res.json());
}

/** 项目级「断开 Runner」opt-out 标记：避免启动迁移把主动断开的项目又连回去。 */
export function markRunnerDetached(projectId: string, detached: boolean) {
  try {
    if (detached) window.localStorage.setItem(DETACH_PREFIX + projectId, "1");
    else window.localStorage.removeItem(DETACH_PREFIX + projectId);
  } catch { /* best-effort */ }
}
export function isRunnerDetachedByUser(projectId: string): boolean {
  try { return window.localStorage.getItem(DETACH_PREFIX + projectId) === "1"; } catch { return false; }
}

/** 检查实际能力协议；HTTP 可达不代表执行能力可用。 */
export async function testRunnerGateway(config: RunnerGatewayConfig): Promise<{ ok: boolean; message: string }> {
  if(!config.enabled)return {ok:false,message:"Server Target Proxy 当前未启用"};
  try {
    const data=await getTargetProxyCapabilities(config.timeoutMs);
    const ready=data.runConfigured===true;
    window.localStorage.setItem("evolve-runner-capabilities",JSON.stringify({url:"/api/evolution/target-capabilities",capabilities:data,checkedAt:Date.now()}));
    return {
      ok:ready,
      message:ready
        ?`Server Target Proxy 已就绪；Run=${data.runConfigured?"READY":"BLOCKED"}，Release=${data.releaseConfigured?"READY":"BLOCKED"}，Observe=${data.observeConfigured?"READY":"BLOCKED"}。真实外部凭证仅保存在服务器。`
        :"Server Target Proxy 代码已就绪，但服务器尚未配置 EVOLUTION_TARGET_RUN_URL。",
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `无法连通：${error.message}` : "无法连通该地址" };
  }
}

export function connectedTargetConnection(config: RunnerGatewayConfig, projectId?: string): EvolveProject["targetConnection"] {
  if (projectId) markRunnerDetached(projectId, false);
  return {
    adapter: "http",
    connectionId: "runner-gateway",
    status: "connected",
    label: config.label.trim() || "Server Target Proxy",
  };
}

export function detachedTargetConnection(projectId?: string): EvolveProject["targetConnection"] {
  if (projectId) markRunnerDetached(projectId, true);
  return { adapter: "artifact", connectionId: "local-artifact-runtime", status: "connected", label: "AI Artifact Runtime" };
}
