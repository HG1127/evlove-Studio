import { Outlet, Link, useLocation } from "react-router-dom";
import { AlarmClock, BookOpenCheck, ChevronsUp, CircleHelp, FlaskConical, Home, Layers3, PackageCheck, Rocket, Settings2, ShieldCheck, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlobalSearch } from "@/components/global-search";

const nav = [
  { href: "/", label: "工作台", icon: Home },
  { href: "/projects", label: "进化任务", icon: Layers3 },
  { href: "/outputs", label: "成果", icon: PackageCheck },
  { href: "/capabilities", label: "能力库", icon: BookOpenCheck },
];
const advancedNav = [
  { href: "/campaigns", label: "运行与治理", icon: AlarmClock },
  { href: "/experiments", label: "证据与实验", icon: FlaskConical },
  { href: "/releases", label: "发布治理", icon: Rocket },
  { href: "/insights", label: "系统洞察", icon: Waypoints },
  { href: "/readiness", label: "闭环完整性", icon: ShieldCheck },
];

export function AppShell() {
  const location = useLocation();
  const path = location.pathname;
  return <div className="studio-shell min-h-screen bg-background">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] bg-white/85 lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-3 px-5"><div className="grid size-9 place-items-center rounded-xl bg-indigo-600 text-white"><ChevronsUp className="size-5" /></div><div><div className="font-bold tracking-tight">Evolve Studio</div><div className="text-[10px] font-medium text-slate-400">AI Capability Evolution</div></div></div>
      <nav aria-label="主导航" className="overflow-y-auto px-3 py-3">
        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">Studio</div>
        <div className="space-y-1">{nav.map(item => { const Icon=item.icon; const active = item.href === "/" ? path === "/" : path.startsWith(item.href.split("?")[0]); return <Link key={item.label} to={item.href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50", active && "bg-indigo-50 text-indigo-700")}><Icon className="size-4" />{item.label}</Link>; })}</div>
        <details key={path} open={advancedNav.some(item => path.startsWith(item.href))} className="mt-5 border-t pt-4">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">高级</summary>
          <div className="mt-1 space-y-1">{advancedNav.map(item => { const Icon = item.icon; return <Link key={item.href} to={item.href} aria-current={path.startsWith(item.href) ? "page" : undefined} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50", path.startsWith(item.href) && "bg-indigo-50 text-indigo-700")}><Icon className="size-4"/>{item.label}</Link>; })}</div>
        </details>
      </nav>
      <div className="mt-auto border-t p-3"><Link to="/settings" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50"><Settings2 className="size-4" />AI 模型与连接</Link></div>
    </aside>
    <div className="min-w-0 lg:pl-[220px]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-white/80 px-5 backdrop-blur-xl">
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-2"><Link to="/settings" className="grid size-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="帮助与连接状态"><CircleHelp className="size-4" /></Link><div className="hidden rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 sm:block">管理部 · Studio Workspace</div><div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-bold text-white">DZ</div></div>
      </header>
      <nav aria-label="移动端导航" className="flex gap-2 overflow-x-auto border-b bg-white px-4 py-2 lg:hidden">{[...nav, ...advancedNav].map(item => <Link key={item.href} to={item.href} aria-current={path === item.href ? "page" : undefined} className={cn("shrink-0 rounded-lg px-3 py-2 text-sm", path === item.href ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600")}>{item.label}</Link>)}</nav>
      <main className="studio-main mx-auto w-full min-w-0 p-4 lg:p-5"><Outlet/></main>
    </div>
  </div>;
}
