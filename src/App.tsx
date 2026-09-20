import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppShell } from "@/components/app-shell";

// 路由是功能边界：不把项目编辑器、模型设置、成果导出等代码塞进首屏。
// 用户进入对应页面时才请求页面所需模块，导航本身仍保持即时可用。
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const ProjectStudioPage = lazy(() => import("@/pages/project-studio-page"));
const ProblemsPage = lazy(() => import("@/pages/problems"));
const ExperimentsPage = lazy(() => import("@/pages/experiments"));
const ReleasesPage = lazy(() => import("@/pages/releases"));
const LearningsPage = lazy(() => import("@/pages/learnings"));
const TemplatesPage = lazy(() => import("@/pages/templates"));
const OutputsPage = lazy(() => import("@/pages/outputs"));
const CampaignsPage = lazy(() => import("@/pages/campaigns"));
const CapabilitiesPage = lazy(() => import("@/pages/capabilities"));
const InsightsPage = lazy(() => import("@/pages/insights"));
const ReadinessPage = lazy(() => import("@/pages/readiness"));
const ProjectManagementPage = lazy(() => import("@/pages/project-management"));
const SettingsPage = lazy(() => import("@/pages/settings"));

function RouteLoading() {
  return <div className="grid min-h-56 place-items-center rounded-3xl border bg-white p-8 text-sm text-slate-500" role="status">正在加载此功能…</div>;
}

// HashRouter: 预览经 /app-preview/<appId>/ 前缀代理访问, hash 路由保证跳转都相对当前页,
// 不会出现根绝对路径跳出应用作用域。
export default function App() {
  // 运行器必须由用户完成能力握手后连接，不根据 URL 自动迁移项目。
  return <HashRouter><Suspense fallback={<RouteLoading />}>
    <Routes>
      <Route element={<AppShell/>}>
        <Route index element={<DashboardPage/>}/>
        <Route path="projects" element={<ProjectsPage/>}/>
        <Route path="projects/manage" element={<ProjectManagementPage/>}/>
        <Route path="projects/:projectId" element={<ProjectStudioPage/>}/>
        <Route path="problems" element={<ProblemsPage/>}/>
        <Route path="experiments" element={<ExperimentsPage/>}/>
        <Route path="releases" element={<ReleasesPage/>}/>
        <Route path="learnings" element={<LearningsPage/>}/>
        <Route path="outputs" element={<OutputsPage/>}/>
        <Route path="campaigns" element={<CampaignsPage/>}/>
        <Route path="templates" element={<TemplatesPage/>}/>
        <Route path="capabilities" element={<CapabilitiesPage/>}/>
        <Route path="insights" element={<InsightsPage/>}/>
        <Route path="readiness" element={<ReadinessPage/>}/>
        <Route path="settings" element={<SettingsPage/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Route>
    </Routes>
  </Suspense></HashRouter>;
}
