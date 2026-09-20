
import { useMemo } from "react";
import { ProjectStudio } from "./project-studio";
import { getLocalProject } from "../runtime/local-store";
import type { EvolveProject } from "../schemas";

export function ProjectLoader({ projectId, fallback }: { projectId: string; fallback?: EvolveProject }) {
  const project = useMemo(() => getLocalProject(projectId) ?? fallback, [projectId, fallback]);

  if (!project) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8"><div className="font-semibold text-rose-900">项目不存在</div><p className="mt-2 text-sm text-rose-700">该项目可能只保存在另一个浏览器环境，或尚未创建。</p></div>;
  if (!project) return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8"><div className="font-semibold text-rose-900">项目不存在</div><p className="mt-2 text-sm text-rose-700">该项目可能只保存在另一个浏览器环境，或尚未创建。</p></div>;
  return <ProjectStudio project={project} />;
}
