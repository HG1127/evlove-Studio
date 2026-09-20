// 后台任务的「打断作用域」：按项目登记当前运行中的 AbortController。
// 用户点暂停时立即中止在途 AI 请求——暂停即时生效，而不是等当前一步（可能长达一两分钟）跑完。
// runEvolveAi 发请求前自动取当前活跃信号，无需在每层调用里手工透传。

const scopes = new Map<string, AbortController>();
let activeProjectId: string | undefined;

export function beginRunScope(projectId: string): AbortController {
  const controller = new AbortController();
  scopes.set(projectId, controller);
  activeProjectId = projectId;
  return controller;
}

export function endRunScope(projectId: string) {
  scopes.delete(projectId);
  if (activeProjectId === projectId) activeProjectId = undefined;
}

/** 中止指定项目的在途调用；返回是否真的有运行中的作用域被中止。 */
export function abortRunScope(projectId: string): boolean {
  const controller = scopes.get(projectId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isRunScopeAborted(projectId: string): boolean {
  return scopes.get(projectId)?.signal.aborted === true;
}

/** 当前活跃作用域的信号：AI 层发请求时自动挂上，暂停一按全部在途请求立刻失败退出。 */
export function getActiveAbortSignal(): AbortSignal | undefined {
  return activeProjectId ? scopes.get(activeProjectId)?.signal : undefined;
}
