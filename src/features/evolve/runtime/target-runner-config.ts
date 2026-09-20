// 真实 Target Runner（HTTP Target Gateway）运行时配置。
// 原 Next 版靠服务端环境变量；浏览器端改为设置页可配置并持久化到 localStorage。
// 内置 Runner 随应用 HTTP 服务加载，无需单独启动进程或配置端口。
import type { EvolveProject } from "../schemas";

export type RunnerGatewayConfig = {
  enabled: boolean;
  label: string;
  runUrl: string;
  releaseUrl: string;
  bearerToken: string;
  timeoutMs: number;
};

const KEY = "evolve-studio:target-runner:v1";
const DETACH_PREFIX = "evolve-studio:runner-detached:";
export const RUNNER_GATEWAY_EVENT = "evolve-runner-gateway-changed";

const CUSTOM_DEFAULT: RunnerGatewayConfig = { enabled: false, label: "HTTP Target Gateway", runUrl: "", releaseUrl: "", bearerToken: "", timeoutMs: 60000 };

/** 由当前页面地址解析内置网关地址：预览前缀变化时仍然正确。 */
function builtinUrl(suffix: "/run" | "/release"): string {
  let pathname = window.location.pathname;
  if (!pathname.endsWith("/")) {
    pathname = /\/app-[0-9a-f]{32}$/.test(pathname) ? `${pathname}/` : `${pathname.split("/").slice(0, -1).join("/")}/`;
  }
  return new URL(`__runner${suffix}`, `${window.location.origin}${pathname}`).toString();
}

/** 本部署内置的同域 Runner 网关（地址按当前页面实时解析，不落盘）。 */
export function builtinRunnerGateway(): RunnerGatewayConfig {
  return { enabled: true, label: "内置后台执行器", runUrl: builtinUrl("/run"), releaseUrl: builtinUrl("/release"), bearerToken: "", timeoutMs: 60000 };
}

export function isBuiltinRunnerGateway(config: RunnerGatewayConfig): boolean {
  try {
    const url = new URL(config.runUrl, window.location.origin);
    return /\/__runner\/run$/.test(url.pathname) && (url.origin === window.location.origin || (/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && /内置/.test(config.label)));
  } catch { return false; }
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
      const config = { ...CUSTOM_DEFAULT, ...(JSON.parse(raw) as Partial<RunnerGatewayConfig>) };
      // 迁移旧同域配置：localhost/预览前缀变化时始终使用当前应用地址。
      return isBuiltinRunnerGateway(config) ? { ...builtinRunnerGateway(), enabled: config.enabled } : config;
    }
  } catch { /* 落盘损坏时回落到内置网关 */ }
  return builtinRunnerGateway();
}

export function saveRunnerGatewayConfig(config: RunnerGatewayConfig) {
  window.localStorage.setItem(KEY, JSON.stringify(isBuiltinRunnerGateway(config) ? { ...config, runUrl: "/__runner/run", releaseUrl: "/__runner/release", bearerToken: "" } : config));
  window.dispatchEvent(new CustomEvent(RUNNER_GATEWAY_EVENT));
}

export function isRunnerGatewayReady(config: RunnerGatewayConfig = getRunnerGatewayConfig()): boolean {
  return config.enabled && Boolean(config.runUrl.trim());
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
  const url = config.runUrl.trim();
  if (!url) return { ok: false, message: "请先填写 Run URL" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {}),
      },
      signal: AbortSignal.timeout(Math.max(3000, Math.min(config.timeoutMs, 40000))),
      body: JSON.stringify({ ping: true }),
    });
    if(!res.ok) {
      let detail="";try { const error=await res.json();detail=String(error.error??""); } catch { /* 非 JSON 错误 */ }
      return {ok:false,message:res.status===502&&isBuiltinRunnerGateway(config)?"内置执行器仍指向旧代理：请重启应用开发服务以加载新的后台 Runner。":`执行器不可用（HTTP ${res.status}）${detail?`：${detail}`:res.status===401||res.status===403?"，请检查鉴权。":"，请检查服务是否已部署。"}`};
    }
    const data=await res.json();
    if(data.ok!==true || data.pong!==true || data.protocol!=="evolve-runner/2") return {ok:false,message:"网关未返回受支持的能力协议，请升级执行器。"};
    const capabilities=data.capabilities;
    window.localStorage.setItem("evolve-runner-capabilities",JSON.stringify({url,capabilities,checkedAt:Date.now()}));
    const ready=!!(capabilities?.htmlBrowser||capabilities?.build||capabilities?.e2e);
    return {ok:ready,message:ready?`后台能力已就绪：${[capabilities?.htmlBrowser?"HTML 真实浏览器 / 双视口截图 / 交互断言":"",capabilities?.build?"Docker 工程构建":""].filter(Boolean).join("；")}。${capabilities?.release?"Production Release Runner 已连接真实 Deploy / Traffic / Telemetry。":"Production Release Runner 尚未配置真实发布平台，/release 会 fail-closed。"}`:"后台服务在线，但没有可用浏览器。Windows 请安装 Edge/Chrome；其他环境执行 npm run runner:install-browser 后重新检测。"};
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
    label: config.label.trim() || "HTTP Target Gateway",
  };
}

export function detachedTargetConnection(projectId?: string): EvolveProject["targetConnection"] {
  if (projectId) markRunnerDetached(projectId, true);
  return { adapter: "artifact", connectionId: "local-artifact-runtime", status: "connected", label: "AI Artifact Runtime" };
}
