
import { useEffect, useState } from "react";
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import { isDemoRemoved, listLocalProjects } from "./local-store";
import { productionRuntimeMode } from "./production-runtime";

/**
 * 本地原型才允许展示 demo；HTTP/Production 的 Mission 集合必须剔除
 * 内置示例（包括历史本地存储中同 ID 的副本），防止虚构问题/Trace
 * 混入真实列表、全局搜索、统计并链接到不存在的服务端 Mission。
 */
export function composeProjects(includeDemo = productionRuntimeMode() === "local"): EvolveProject[] {
  const stored = listLocalProjects();
  if (productionRuntimeMode() !== "local" || !includeDemo) {
    return stored.filter((item) => item.id !== demoProject.id);
  }
  const storedDemo = stored.find((item) => item.id === demoProject.id);
  const demoEntry = storedDemo ? [storedDemo] : isDemoRemoved() ? [] : [demoProject];
  return [...demoEntry, ...stored.filter((item) => item.id !== demoProject.id)];
}

export function useLocalProjects(options?: { includeDemo?: boolean }) {
  const includeDemo = options?.includeDemo ?? productionRuntimeMode() === "local";
  const [projects, setProjects] = useState<EvolveProject[]>(() => composeProjects(includeDemo));

  useEffect(() => {
    const refresh = () => setProjects(composeProjects(includeDemo));
    refresh();
    window.addEventListener("evolve-projects-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("evolve-projects-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [includeDemo]);

  return projects;
}
