
import { useEffect, useState } from "react";
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import { isDemoRemoved, listLocalProjects } from "./local-store";
import { productionRuntimeMode } from "./production-runtime";
import {missionSyncJournal} from "./project-database";
import {productionSyncStatus} from "./production-sync";

/**
 * 本地原型才允许展示 demo；HTTP/Production 的 Mission 集合必须剔除
 * 内置示例（包括历史本地存储中同 ID 的副本），并要求一次成功的
 * HTTP Mission 同步和服务端已确认 ID。尚未确认的本地草稿/历史缓存
 * 留在本地存储和项目备份中，但不能进入真实列表、搜索和业务统计。
 */
export function composeProjects(includeDemo = productionRuntimeMode() === "local"): EvolveProject[] {
  const stored = listLocalProjects();
  if(productionRuntimeMode()==="http"){
    if(productionSyncStatus().realtimeStatus!=="http-polling")return [];
    const journal=missionSyncJournal();
    const confirmed=new Set(journal.knownRemoteIds);
    const deleting=new Set(journal.pendingDeleteIds);
    return stored.filter(item=>item.id!==demoProject.id&&confirmed.has(item.id)&&!deleting.has(item.id));
  }
  if(!includeDemo)return stored.filter(item=>item.id!==demoProject.id);
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
    window.addEventListener("evolve-production-realtime-status", refresh);
    return () => {
      window.removeEventListener("evolve-projects-changed", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("evolve-production-realtime-status", refresh);
    };
  }, [includeDemo]);

  return projects;
}
