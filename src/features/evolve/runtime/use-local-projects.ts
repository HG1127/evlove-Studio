
import { useEffect, useState } from "react";
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import { isDemoRemoved, listLocalProjects } from "./local-store";

/**
 * 统一的项目列表口径：存储里的项目优先（含改名后的示例项目）；
 * 内置示例只在「从未被删除」时补位。列表页、仪表盘、全局搜索共用，
 * 保证在一个入口删掉的项目不会从另一个入口复活。
 */
export function composeProjects(includeDemo = true): EvolveProject[] {
  const stored = listLocalProjects();
  if (!includeDemo) return stored;
  const storedDemo = stored.find((item) => item.id === demoProject.id);
  const demoEntry = storedDemo ? [storedDemo] : isDemoRemoved() ? [] : [demoProject];
  return [...demoEntry, ...stored.filter((item) => item.id !== demoProject.id)];
}

export function useLocalProjects(options?: { includeDemo?: boolean }) {
  const includeDemo = options?.includeDemo ?? true;
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
