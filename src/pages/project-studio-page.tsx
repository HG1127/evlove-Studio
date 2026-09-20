import { useParams } from "react-router-dom";
import { demoProject } from "@/features/evolve/data/mock-project";
import { ProjectLoader } from "@/features/evolve/components/project-loader";

// 原 Next 版在 server component 里 await 项目数据；浏览器端等价：demo 项目直接给
// fallback，其余项目从本地存储读取（ProjectLoader 内部处理）。
export default function ProjectStudioPage() {
  const { projectId } = useParams();
  const id = projectId ?? "";
  return <ProjectLoader projectId={id} fallback={id === "demo" ? demoProject : undefined} />;
}
