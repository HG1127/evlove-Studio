import type { EvolveProject } from "../schemas";

/**
 * 模板中心数据源：模板 = 可复用的「项目启动包」（部门、对象类型、进化目标、推荐指标）。
 * 内置模板随代码发布、不可删除；自定义模板与所有模板的使用统计存本地，
 * 创建项目时预填向导并回写 templateId，模板中心据此反查关联项目与使用次数。
 */
export interface EvolveTemplate {
  id: string;
  name: string;
  category: string;
  department: string;
  objectType: string;
  scenarios: string;
  goal: string;
  metrics: string[];
  builtIn: boolean;
  useCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const KEY = "evolve-studio:templates:v1";
export const TEMPLATES_CHANGED_EVENT = "evolve-templates-changed";

type TemplateStore = {
  custom: EvolveTemplate[];
  usage: Record<string, { useCount: number; lastUsedAt?: string }>;
};

const BUILT_IN_SEEDS: Array<Omit<EvolveTemplate, "builtIn" | "useCount" | "createdAt" | "updatedAt">> = [
  { id: "tpl-research", name: "投资研究 / 行业研究 / 周策略", category: "策略研究", department: "策略部", objectType: "agent", scenarios: "周报、观点综述、行业跟踪等研究产出", goal: "进化周策略报告：让每个关键观点都有证据与反证校验，结论可复核", metrics: ["证据", "准确率", "风险", "反证"] },
  { id: "tpl-customer", name: "客户报告 / 客诉 / FAQ", category: "客户服务", department: "客户部", objectType: "agent", scenarios: "客诉回复、客户周报、FAQ 问答", goal: "进化客诉回复与 FAQ：完整覆盖问题、语气稳定、时效与合规达标", metrics: ["完整性", "语气", "时效", "合规"] },
  { id: "tpl-sales", name: "邮件 / 线索 / 跟进", category: "销售触达", department: "客户部", objectType: "workflow", scenarios: "线索跟进邮件、触达话术、召回流程", goal: "进化触达邮件：理解线索意图、个性化内容、提升转化且不超长度", metrics: ["意图理解", "个性化", "转化", "长度"] },
  { id: "tpl-ops", name: "日报 / 周报 / OKR", category: "管理运营", department: "管理部", objectType: "template", scenarios: "团队日报周报、OKR 复盘、会议纪要", goal: "进化周报：结构完整、行动项可执行、进展描述准确不夸大", metrics: ["完整度", "结构", "行动项", "准确性"] },
  { id: "tpl-doc", name: "BP / Executive Summary", category: "文档报告", department: "管理部", objectType: "template", scenarios: "商业计划书、高管摘要、立项文档", goal: "进化 BP 与高管摘要：事实一致、结构清晰、关键数字可溯源", metrics: ["事实", "结构", "一致性", "来源"] },
  { id: "tpl-analytics", name: "分析 Agent / Dashboard", category: "数据分析", department: "技术部", objectType: "agent", scenarios: "取数分析、指标看板、异常归因", goal: "进化分析 Agent：计算口径正确、异常主动解释、结论可复算", metrics: ["计算正确", "口径", "异常", "可解释"] },
  { id: "tpl-agent", name: "通用 AI Agent", category: "Agent", department: "AI部", objectType: "agent", scenarios: "任务型 Agent、工具调用、多步执行", goal: "进化通用 Agent：提升任务成功率与工具调用质量，控制成本", metrics: ["成功率", "工具", "Workflow", "成本"] },
  { id: "tpl-workflow", name: "多 Agent / 自动化", category: "AI Workflow", department: "AI部", objectType: "workflow", scenarios: "多 Agent 编排、自动化流水线、失败重试", goal: "进化多 Agent 自动化流：路由准确、失败可恢复、延迟与稳定性达标", metrics: ["路由", "失败恢复", "延迟", "稳定性"] },
];

function readStore(): TemplateStore {
  if (typeof window === "undefined") return { custom: [], usage: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { custom: [], usage: {} };
    const parsed = JSON.parse(raw) as Partial<TemplateStore>;
    return { custom: Array.isArray(parsed.custom) ? parsed.custom : [], usage: parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {} };
  } catch {
    return { custom: [], usage: {} };
  }
}

function writeStore(store: TemplateStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent(TEMPLATES_CHANGED_EVENT));
  } catch {
    // 本地存储不可用时静默降级：模板仅本次会话有效
  }
}

function withUsage(template: Omit<EvolveTemplate, "useCount" | "lastUsedAt">, usage: TemplateStore["usage"]): EvolveTemplate {
  const stat = usage[template.id];
  return { ...template, useCount: stat?.useCount ?? 0, lastUsedAt: stat?.lastUsedAt };
}

const BUILT_IN_AT = "2026-01-01T00:00:00.000Z";

export function listTemplates(): EvolveTemplate[] {
  const store = readStore();
  const builtIn = BUILT_IN_SEEDS.map((seed) => withUsage({ ...seed, builtIn: true, createdAt: BUILT_IN_AT, updatedAt: BUILT_IN_AT }, store.usage));
  const custom = store.custom.map((item) => withUsage({ ...item, builtIn: false }, store.usage))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...custom, ...builtIn];
}

export function getTemplate(id: string): EvolveTemplate | undefined {
  return listTemplates().find((template) => template.id === id);
}

/** 新建 / 编辑自定义模板；内置模板不可改（编辑入口只对自定义开放）。 */
export function saveTemplate(template: EvolveTemplate) {
  const store = readStore();
  const record: EvolveTemplate = { ...template, builtIn: false };
  const exists = store.custom.some((item) => item.id === record.id);
  store.custom = exists ? store.custom.map((item) => (item.id === record.id ? record : item)) : [record, ...store.custom];
  writeStore(store);
}

export function deleteTemplate(id: string) {
  const store = readStore();
  store.custom = store.custom.filter((item) => item.id !== id);
  writeStore(store);
}

/** 复制任意模板（含内置）为自定义模板，返回新副本供继续编辑。 */
export function duplicateTemplate(id: string): EvolveTemplate | undefined {
  const source = getTemplate(id);
  if (!source) return undefined;
  const copy: EvolveTemplate = {
    ...source,
    id: `tpl-${Date.now()}`,
    name: `${source.name}（副本）`,
    builtIn: false,
    useCount: 0,
    lastUsedAt: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveTemplate(copy);
  return copy;
}

/** 项目创建时回写：使用次数 + 最近使用时间，模板中心据此排序与展示。 */
export function recordTemplateUse(id: string) {
  const store = readStore();
  const stat = store.usage[id] ?? { useCount: 0 };
  store.usage[id] = { useCount: stat.useCount + 1, lastUsedAt: new Date().toISOString() };
  writeStore(store);
}

/** 把已有项目沉淀为模板：目标、部门、对象类型、指标直接复用，一键起步同类项目。 */
export function templateFromProject(project: EvolveProject): EvolveTemplate {
  const at = new Date().toISOString();
  return {
    id: `tpl-${Date.now()}`,
    name: `${project.name} · 同类模板`,
    category: project.department === "其他" ? "自定义" : project.department,
    department: project.department,
    objectType: project.objectType,
    scenarios: (project.problemStatement ?? "").slice(0, 80) || project.goal.slice(0, 80),
    goal: project.goal,
    metrics: project.metrics.map((metric) => metric.label).slice(0, 6),
    builtIn: false,
    useCount: 0,
    createdAt: at,
    updatedAt: at,
  };
}
