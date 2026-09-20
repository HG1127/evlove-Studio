import type {
  AcceptanceCriterion,
  ArtifactGraph,
  ArtifactGraphNode,
  EvolveProject,
  SemanticEvolution,
  SemanticObject,
  SourceArtifact,
} from "../schemas";
import { describeArtifact } from "./artifact-strategy";

function extensionOf(name: string) {
  const part = name.split(".").pop()?.toLowerCase() ?? "";
  return part === name.toLowerCase() ? "" : part;
}

function familyFromExtension(name: string) {
  const ext = extensionOf(name);
  if (["pptx", "ppt", "odp"].includes(ext)) return "presentation";
  if (["xlsx", "xls", "ods", "csv", "tsv"].includes(ext)) return "spreadsheet";
  if (["docx", "doc", "odt", "rtf", "md", "txt", "pdf"].includes(ext)) return "document";
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "php", "vue", "svelte", "sql"].includes(ext)) return "code";
  if (["json", "yaml", "yml"].includes(ext)) return "structured-data";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["mp4", "mov", "avi", "webm", "mp3", "wav", "m4a"].includes(ext)) return "media";
  if (ext === "zip") return "package";
  return ext ? "file" : "unknown";
}

function containerType(artifact: SourceArtifact) {
  const ext = (artifact.extension || extensionOf(artifact.name)).toLowerCase();
  if (ext === "zip") return "zip";
  if (ext === "pptx") return "pptx";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "pdf") return "pdf";
  if (artifact.mimeType.startsWith("image/")) return "image";
  if (artifact.mimeType.startsWith("audio/")) return "audio";
  if (artifact.mimeType.startsWith("video/")) return "video";
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "php", "vue", "svelte", "sql"].includes(ext)) return "code-file";
  if (["json", "yaml", "yml", "csv", "tsv"].includes(ext)) return "structured-data";
  if (["txt", "md", "mdx", "html", "htm", "rtf"].includes(ext) || artifact.mimeType.startsWith("text/")) return "text";
  return artifact.parseStatus === "binary" ? "binary" : "unknown";
}

function packageEntries(artifact: SourceArtifact): Array<{ path: string; family: string; role?: string; content?: string }> {
  const value = artifact.structuredContent as { kind?: string; manifest?: string[]; entries?: Array<{ path?: string; name?: string; family?: string; role?: string; content?: string }>; files?: Array<{ path?: string; content?: string }> } | undefined;
  if (!value) return [] as Array<{ path: string; family: string; role?: string; content?: string }>;
  if (Array.isArray(value.entries)) return value.entries.map((entry) => ({ path: entry.path || entry.name || "unknown", family: entry.family || familyFromExtension(entry.path || entry.name || ""), role: entry.role, content: entry.content }));
  if (Array.isArray(value.files)) return value.files.map((entry) => ({ path: entry.path || "unknown", family: familyFromExtension(entry.path || ""), role: "implementation", content: entry.content }));
  return (value.manifest ?? artifact.structure ?? []).map((path) => ({ path, family: familyFromExtension(path) }));
}

export function buildArtifactGraph(artifacts: SourceArtifact[]): ArtifactGraph {
  const nodes: ArtifactGraphNode[] = [];
  const edges: ArtifactGraph["edges"] = [];
  for (const artifact of artifacts.filter((item) => item.role === "target")) {
    const descriptor = artifact.artifactDescriptor ?? describeArtifact(artifact);
    const rootId = `artifact:${artifact.id}`;
    nodes.push({
      id: rootId,
      sourceArtifactId: artifact.id,
      name: artifact.name,
      containerType: containerType(artifact),
      artifactFamily: descriptor.family,
      semanticRole: "primary-target",
      extension: artifact.extension,
      editable: descriptor.editable,
      summary: artifact.summary || artifact.textExcerpt,
    });
    if ((artifact.extension || "").toLowerCase() === "zip") {
      const packageItems = packageEntries(artifact);
      const semanticItems = packageItems.filter((entry)=>!["test-evidence","reference-evidence"].includes(entry.role ?? ""));
      const evidenceItems = packageItems.filter((entry)=>["test-evidence","reference-evidence"].includes(entry.role ?? ""));
      for (const [index, entry] of [...semanticItems, ...evidenceItems].slice(0, 360).entries()) {
        const childId = `${rootId}:entry:${index}`;
        nodes.push({
          id: childId,
          sourceArtifactId: artifact.id,
          parentId: rootId,
          path: entry.path,
          name: entry.path.split("/").pop() || entry.path,
          containerType: "file",
          artifactFamily: entry.family,
          semanticRole: entry.role || "package-component",
          extension: extensionOf(entry.path),
          editable: true,
          summary: entry.content?.slice(0, 240),
        });
        edges.push({ from: rootId, to: childId, relation: "contains", description: `ZIP 包含 ${entry.path}` });
      }
    }
  }
  const targetRoots = nodes.filter((node) => !node.parentId && node.semanticRole === "primary-target");
  if (targetRoots.length > 1) {
    for (let i = 0; i < targetRoots.length; i += 1) {
      for (let j = i + 1; j < targetRoots.length; j += 1) {
        edges.push({ from: targetRoots[i]!.id, to: targetRoots[j]!.id, relation: "must-match", description: "多成果项目：关键事实、数字、术语与结论需要联合验收" });
      }
    }
  }
  const families = [...new Set(nodes.filter((node) => !node.parentId || node.semanticRole === "package-component").map((node) => node.artifactFamily))];
  return { nodes, edges, summary: `共识别 ${nodes.length} 个结构节点，涉及 ${families.join("、") || "未知"}；${targetRoots.length > 1 ? "已建立跨成果一致性关系。" : "单成果独立进化。"}`, generatedAt: new Date().toISOString() };
}

const semanticPatterns: Array<{ id: string; label: string; domain: string; patterns: RegExp[]; outcome: string; audience: string[]; cross: string[] }> = [
  { id: "fundraising-data-room", label: "融资资料体系", domain: "融资/资本", patterns: [/融资|投资人|投资经理|FA/i, /商业计划|pitch|deck|\bBP\b|data.?room|尽调/i, /财务模型|估值|融资用途|收入预测/i, /公司介绍|团队介绍|市场规模/i], outcome: "让投资人更快理解项目、验证关键事实并形成投资判断", audience: ["投资人", "投资经理", "FA"], cross: ["财务数字在 PPT、Excel、公司介绍之间一致", "核心叙事、市场规模、融资用途与财务预测相互支持"] },
  { id: "strategy-operating-system", label: "企业战略经营体系", domain: "战略/管理", patterns: [/战略|经营计划|年度规划/i, /经营目标|年度目标|关键目标/i, /okr|关键结果|KR\b/i, /组织架构|责任部门|部门目标/i, /指标|经营指标|KPI/i], outcome: "形成战略→目标→组织→行动/OKR 的可执行闭环", audience: ["管理层", "部门负责人"], cross: ["战略目标必须映射到指标、部门和执行动作", "不同文件中的目标、数字、职责口径一致"] },
  { id: "hr-policy-system", label: "企业制度与人力体系", domain: "人力/制度", patterns: [/员工手册|人事|HR\b/i, /考勤|薪酬|绩效/i, /保密制度|制度|policy/i, /审批流程|权限|处罚|例外/i], outcome: "形成无冲突、权责清晰、可执行的制度体系", audience: ["员工", "HR", "管理者"], cross: ["制度之间不得存在互相冲突的定义、权限与流程", "关键角色、审批、例外和处罚规则必须闭环"] },
  { id: "training-course-package", label: "培训课程/教学体系", domain: "培训/知识", patterns: [/培训|课程|教程|教学/i, /学习路径|学习目标|先备知识/i, /sop|实操|操作指南|步骤/i, /课件|教材|练习|作业|验收/i], outcome: "让目标学习者容易理解、能按步骤操作并完成验收", audience: ["学习者", "内部员工"], cross: ["课程、课件、练习和操作说明前后一致", "学习目标必须映射到内容、练习与验收"] },
  { id: "brand-asset-system", label: "品牌资产体系", domain: "品牌/市场", patterns: [/品牌|brand|定位/i, /logo|VI\b|视觉|品牌手册/i, /海报|宣传|文案/i, /模板|传播素材|社媒/i], outcome: "形成语言、视觉、模板和传播材料一致的品牌体系", audience: ["客户", "市场团队"], cross: ["品牌名称、定位、视觉和文案规范跨成果一致", "不同媒介保持同一品牌调性但适应场景"] },
  { id: "investment-research-package", label: "投资研究体系", domain: "投资/研究", patterns: [/投资研究|行业研究|公司研究|research/i, /估值|valuation|财务模型/i, /投资逻辑|催化|观点/i, /风险分析|反证|下行情景/i, /来源|证据|引用/i], outcome: "形成事实可验证、逻辑完整、风险充分且数据一致的研究成果", audience: ["投资经理", "决策者"], cross: ["研究结论、财务模型和引用证据口径一致", "关键判断必须可追溯到数据或来源"] },
  { id: "marketing-campaign", label: "营销活动体系", domain: "市场/增长", patterns: [/营销|campaign|广告|投放/i, /内容矩阵|素材|文案/i, /增长|获客|转化/i, /社媒|渠道|受众/i], outcome: "形成目标、受众、内容、渠道和转化指标一致的营销闭环", audience: ["目标客户", "市场团队"], cross: ["受众、卖点、素材、渠道和转化指标相互匹配"] },
  { id: "product-spec-package", label: "产品需求与设计体系", domain: "产品/研发", patterns: [/prd|产品需求|需求文档/i, /原型|交互|设计规范/i, /用户故事|用户场景/i, /验收标准|状态|权限|字段/i, /工程实现|研发/i], outcome: "让需求、用户场景、交互和工程实现可追踪且一致", audience: ["产品", "设计", "研发"], cross: ["需求必须映射到交互、验收和工程实现", "跨文档的字段、状态、权限和流程口径一致"] },
  { id: "software-system", label: "软件/AI 系统", domain: "研发/技术", patterns: [/软件系统|代码工程|AI系统|应用系统/i, /package\.json|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml/i, /(^|\/)src\/|(^|\/)app\/|(^|\/)tests?\//i, /接口|\bAPI\b|schema/i, /组件|代码|runtime|agent/i, /构建|typecheck|lint|单元测试|e2e/i], outcome: "让系统在保留契约和兼容性的前提下功能更完整、可测试、可维护", audience: ["用户", "研发团队"], cross: ["需求、接口、Schema、实现与测试保持一致"] },
];

function semanticCorpus(artifacts: SourceArtifact[], command: string, graph: ArtifactGraph) {
  const primaryRoles = new Set(["primary-target","implementation","configuration","content","documentation","package-component"]);
  const graphText = graph.nodes.slice(0, 240).map((node) => {
    const summary = primaryRoles.has(node.semanticRole) ? (node.summary || "") : "";
    return `${node.path || node.name} ${summary}`;
  }).join("\n");
  return `${command}\n${artifacts.map((item) => `${item.name}\n${item.summary || ""}\n${item.textExcerpt || ""}`).join("\n")}\n${graphText}`.slice(0, 140_000);
}

function softwareStructureScore(artifacts: SourceArtifact[], graph: ArtifactGraph) {
  let score = 0;
  const paths = graph.nodes.map((node) => (node.path || node.name).toLowerCase());
  const strong = [/^package\.json$/, /(^|\/)package\.json$/, /(^|\/)pyproject\.toml$/, /(^|\/)go\.mod$/, /(^|\/)cargo\.toml$/, /(^|\/)requirements\.txt$/, /(^|\/)src\//, /(^|\/)app\//, /(^|\/)tests?\//];
  for (const pattern of strong) if (paths.some((path) => pattern.test(path))) score += 1;
  if (artifacts.some((item) => item.artifactDescriptor?.family === "codebase" || item.artifactKind === "codebase")) score += 3;
  const codeNodes = graph.nodes.filter((node) => node.artifactFamily === "code").length;
  if (codeNodes >= 5) score += 1;
  if (codeNodes >= 20) score += 1;
  return score;
}

function heuristicSemanticObject(artifacts: SourceArtifact[], command: string, graph: ArtifactGraph): SemanticObject {
  const corpus = semanticCorpus(artifacts, command, graph);
  const softwareScore = softwareStructureScore(artifacts, graph);
  const explicitNotSoftware = /不是(?:软件|代码|项目)|不要当成(?:软件|代码)|非代码|并非(?:软件|代码)/i.test(command);
  const scored = semanticPatterns.map((item) => {
    const raw = item.patterns.reduce((sum, pattern) => sum + (pattern.test(corpus) ? 1 : 0), 0);
    const explicitBoost = item.patterns[0]?.test(command) ? 1.25 : 0;
    // “ZIP/文档里出现 API/Agent/Schema”不等于软件工程。负向用户声明优先于词面命中；只有真实工程结构可覆盖该负向提示。
    const score = item.id === "software-system" && explicitNotSoftware && softwareScore < 2
      ? 0
      : item.id === "software-system" && softwareScore < 2 && explicitBoost === 0
        ? Math.min(raw, 1)
        : item.id === "software-system"
          ? raw + explicitBoost + Math.min(3, softwareScore)
          : raw + explicitBoost;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const targetIds = artifacts.filter((item) => item.role === "target").map((item) => item.id);
  if (best && best.score >= 2) return {
    typeId: best.item.id, label: best.item.label, domain: best.item.domain,
    description: `系统根据文件内容、内部结构、成果之间的关系和用户命令识别为“${best.item.label}”；ZIP 仅被视为容器，不会因为扩展名自动当成代码工程。`,
    confidence: Math.min(0.94, 0.58 + best.score * 0.065), audience: best.item.audience, primaryOutcome: best.item.outcome,
    componentArtifactIds: targetIds, crossArtifactRequirements: best.item.cross,
    reasoning: [
      ...scored.slice(0, 3).filter((item) => item.score > 0).map((item) => `${item.item.label} 命中 ${item.score} 组语义/结构信号`),
      ...(softwareScore > 0 ? [`软件工程结构信号 ${softwareScore} 分`] : []),
    ].slice(0, 8),
  };
  const targetFamilies = [...new Set(artifacts.filter((item) => item.role === "target").map((item) => item.artifactDescriptor?.family || item.artifactKind))];
  const packageNodeCount = graph.nodes.filter((node) => node.semanticRole === "package-component").length;
  return {
    typeId: targetFamilies.length > 1 || packageNodeCount > 1 ? "generic-multi-artifact-package" : "generic-evolution-object",
    label: targetFamilies.length > 1 || packageNodeCount > 1 ? "复合业务成果体系" : "业务成果",
    domain: "通用", description: "未命中足够强的预置业务语义。系统不会强行套代码/PPT等固定业务流程，而是以用户进化命令为主目标，根据 Artifact Graph 动态编译流程和验收标准。",
    confidence: 0.55, audience: [], primaryOutcome: command || "在保持原格式和关键约束的前提下实质提升成果质量",
    componentArtifactIds: targetIds,
    crossArtifactRequirements: targetIds.length > 1 || packageNodeCount > 1 ? ["不同组成成果中的关键事实、数字、术语和结论保持一致", "各组成部分按自身结构进化，并在联合验收阶段检查整体业务闭环"] : [],
    reasoning: [`识别到物理成果族：${targetFamilies.join("、") || "未知"}`, `Artifact Graph 包含 ${graph.nodes.length} 个节点`],
  };
}
function intentFromCommand(command: string, semanticObject: SemanticObject, artifacts: SourceArtifact[]) {
  const desired = command.split(/[；;。\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  const mustPreserve = artifacts.filter((item) => item.role === "target").map((item) => `${item.name} 保持原格式/原容器交付`);
  const outputRequirements = artifacts.filter((item) => item.role === "target").map((item) => `输出 ${item.name} 的进化后同格式版本`);
  return {
    summary: command || `围绕${semanticObject.label}的核心业务结果持续进化`,
    desiredChanges: desired.length ? desired : [semanticObject.primaryOutcome],
    mustPreserve,
    outputRequirements,
    qualityPriorities: [semanticObject.primaryOutcome, ...semanticObject.crossArtifactRequirements].slice(0, 6),
  };
}

function workflowForSemantic(object: SemanticObject, artifactIds: string[]) {
  const defs: Record<string, Array<["define"|"baseline"|"diagnose"|"evolve"|"verify"|"deliver", string, string, string, string, string, string]>> = {
    "software-system": [
      ["define","产品目标","系统 + 用户要求 → 产品进化契约","代码工程、用户命令、现有接口/数据契约","先明确用户真正要改善的产品结果、受保护契约和交付格式；内部实现只作为证据","产品验收契约","成果物兼容、流程闭环、UI/UX 等用户目标被逐项定义"],
      ["baseline","系统建模","代码工程 → 架构/路由/状态/测试证据图","文件树、AST、路由、Schema、现有测试","区分产品实现、配置、测试证据和参考文档，建立系统结构基线；测试 fixture 不作为业务对象本身","系统证据图 + Baseline","知道系统当前具备什么、哪些只能静态证明、哪些必须真实运行验证"],
      ["diagnose","产品诊断","用户场景 + 结构证据 + 真实运行证据 → 问题/原因","Baseline、Trace、静态证据、E2E/视觉证据（若已接入）","先描述用户可观察问题，再定位实现根因；Runner/解析能力缺失单独记为证据缺口","问题地图 + 可证伪根因","问题与原因分开，未验证不被误判成产品失败"],
      ["evolve","系统进化","根因 → 多方案 → 完整工程候选","根因、受保护契约、当前工程快照","按文件/模块构建多个真实 Candidate；修改流程、兼容层、UI/UX 时保持 Schema/API/存储契约兼容","完整候选工程快照","候选是可继续构建/测试的新版系统，不是 Patch 说明"],
      ["verify","双层验收","候选工程 → 产品场景 + 工程完整性","代表性输入兼容场景、流程场景、视觉/UI 场景、静态/构建/E2E 证据","用户目标优先；静态源码只证明实现存在，UI/交互必须真实 Runner/视觉审查。无法验证则标记待验证而非 FAIL","产品验收矩阵 + 证据覆盖","已有证据的 Hard Gate 通过；未验证项被明确列出并阻止 Release"],
      ["deliver","工程交付","已验收快照 → 原 ZIP/工程输出","同一 Candidate Snapshot + 验收记录","回写原工程结构并输出版本/差异/验证状态；不在交付时重新生成另一版","同格式工程包 + 验收报告","下载的工程就是被验收过的同一 Snapshot"],
    ],
    "fundraising-data-room": [
      ["define","融资目标","融资对象与目标 → 投资人验收契约","全部融资资料 + 融资目标","识别投资人、融资阶段、核心论点、关键数字和不可破坏事实","Investor Readiness Contract","融资目标、投资人关切和关键数字口径明确"],
      ["baseline","资料关系","资料包 → 事实/数字/叙事关系图","PPT/Excel/Word/PDF 等","建立跨文件事实、财务数字、团队、市场、融资用途关系","Data Room Relationship Map","知道不同资料之间必须一致的字段和论点"],
      ["diagnose","说服力诊断","关系图 + 当前成果 → 缺口与矛盾","跨文件证据 + 投资人视角","定位数字冲突、叙事断点、信息缺口和弱说服点","融资问题地图 + 根因","问题和原因分开，能说明为什么影响投资判断"],
      ["evolve","分成果进化","根因 → 各文件专用 Builder → 联合候选包","每个原生格式成果","PPT 按叙事、Excel 按模型、文档按结构分别进化，并同步共享事实","多份同格式 Candidate Package","每个候选都是真实成果包，不是统一文本改写"],
      ["verify","联合验收","候选包 → 投资人就绪度 + 跨文件一致性","完整候选资料包","分别验收各格式，同时检查数字/术语/论点跨文件一致","Investor Readiness Scorecard","硬门槛、跨文件一致性和用户要求全部通过"],
      ["deliver","资料包交付","已验收快照 → 原格式打包","同一份已验收成果","按原格式回写并重新打包 ZIP，不重新生成另一版","PPTX/XLSX/DOCX/... + ZIP","下载内容就是被验收过的同一套资料"],
    ],
    "strategy-operating-system": [
      ["define","战略目标","战略资料 → 战略闭环契约","战略/经营/组织/OKR 资料","明确战略周期、关键目标、核心指标和保护边界","战略验收契约","战略到底要落到什么指标与行动已明确"],
      ["baseline","战略关系","战略 → 指标 → 组织 → OKR 关系建模","全部战略体系成果","抽取目标、指标、责任部门、行动和 KR 的映射","战略关系图","所有成果之间的上下游关系可追踪"],
      ["diagnose","断点诊断","关系图 → 战略断点与冲突","关系图 + 当前成果","找出战略未落指标、指标未落责任、职责冲突、数字口径不一致","战略断点地图 + 根因","知道哪里断、为什么断、影响什么"],
      ["evolve","体系进化","根因 → 分成果重构 + 映射修复","PPT/Excel/制度/OKR 等","分别优化叙事、指标、职责、KR，并修复跨成果映射","战略体系候选包","每个候选形成完整可执行战略链"],
      ["verify","闭环验收","候选 → 战略闭环与一致性","候选成果体系","检查战略→指标→组织→行动/OKR 是否完整闭环","战略闭环验收矩阵","每个战略目标都有指标、责任和执行动作"],
      ["deliver","体系交付","已验收体系 → 同格式交付","已验收候选","按原格式回写各成果并打包","战略体系交付包","原格式可编辑、跨文件口径一致"],
    ],
    "hr-policy-system": [
      ["define","制度目标","制度资料 → 权责/合规契约","全部制度与流程","明确适用对象、权责、审批、例外和保护条款","制度验收契约","什么能改、什么不能改和合规边界明确"],
      ["baseline","制度关系","制度 → 角色/权限/流程关系图","制度文档 + 流程表","建立定义、角色、审批、例外和处罚的跨制度关系","制度关系图","相互引用和共享定义可追踪"],
      ["diagnose","冲突诊断","关系图 → 冲突/缺口/模糊责任","当前制度体系","定位定义冲突、权限断点、缺少例外、流程不闭环","制度问题地图 + 根因","问题与原因分明"],
      ["evolve","制度进化","根因 → 分制度修订 + 跨制度同步","原格式制度成果","按制度类型分别修改，同时同步公共定义与流程","制度体系候选包","所有修订可追溯且保持原格式"],
      ["verify","体系验收","候选 → 无冲突/权责/闭环验收","完整候选制度包","逐制度验收并做跨制度冲突检查","制度验收矩阵","Hard Gate 全过且关键制度无冲突"],
      ["deliver","制度交付","已验收制度包 → 原格式打包","已验收成果","按原格式回写并保留版本记录","制度体系交付包","下载包可直接进入审批/发布"],
    ],
    "training-course-package": [
      ["define","学习目标","学习者 + 课程资料 → 学习验收契约","课件/教程/SOP/练习","明确学习者、先备知识、目标技能和完成标准","学习目标契约","每个目标能映射到内容和练习"],
      ["baseline","学习路径","课程内容 → 知识/步骤/练习关系","所有培训成果","建立章节、概念、步骤、演示、练习与验收关系","学习路径图","学习顺序与依赖清晰"],
      ["diagnose","学习障碍","路径图 → 理解/操作障碍","当前课程 + 用户场景","定位术语跳跃、步骤缺失、练习不足、导航不清","学习障碍地图 + 根因","能说明学习者为什么会卡住"],
      ["evolve","课程进化","根因 → 分成果教学重构","PPT/文档/练习/模板","按教学目标重构叙事、步骤、示例和练习","课程候选包","不是单纯润色，而是提高可学可做性"],
      ["verify","学习验收","候选 → 理解/实操/覆盖验收","课程候选包","检查目标覆盖、步骤可执行、练习可验证、跨材料一致","学习效果验收矩阵","目标→内容→练习→验收完整"],
      ["deliver","课程交付","已验收课程 → 原格式交付","同一已验收快照","保持 PPTX/DOCX/XLSX 等格式打包","课程交付包","可直接培训使用"],
    ],
  };
  const generic: typeof defs[string] = [
    ["define","理解目标","成果 + 用户要求 → 进化契约","全部进化对象、参考材料、用户命令","理解业务对象、受众、目标、保护边界和最终格式","业务对象模型 + 进化契约","系统知道“这是什么、为谁用、要变好什么”"],
    ["baseline","建立模型","成果结构 → Artifact Graph + 业务关系","原始成果及内部结构","展开容器、识别子成果和关系；ZIP 只作为容器，不直接等于代码","Artifact Graph + 业务关系图","所有实际组成和上下游关系清楚"],
    ["diagnose","诊断问题","关系图 + 当前表现 → 问题与根因","结构证据、用户目标、测试结果","先描述可观察问题，再定位可证伪根因","问题地图 + 根因","问题和原因严格分开"],
    ["evolve","自适应进化","根因 → 专用 Builder → 候选成果","各成果原生结构","每个子成果按其格式/业务角色选择 Builder，并同步跨成果共享事实","多个真实 Candidate Artifact/Package","候选是真实新版成果而非统一文本"],
    ["verify","动态验收","候选 → 用户目标 + 业务标准 + 格式完整性","完整候选成果","Rubric = 用户要求 + 业务对象标准 + 技术/格式完整性；多成果再做跨文件一致性","项目专属验收矩阵","Hard Gate、用户目标和格式完整性全部通过"],
    ["deliver","原格式交付","已验收快照 → 同格式输出","被验收的同一份成果","按各自原格式物化并保持容器/文件树，禁止重新生成另一个未验收版本","同格式成果包 + 验收报告","下载的就是验收通过的那一版"],
  ];
  const selected = defs[object.typeId] ?? generic;
  return selected.map(([id,label,flow,input,action,output,done]) => ({ id, label, flow, input, action, output, done, applicableArtifactIds: artifactIds }));
}

export function semanticAcceptanceCriteria(object: SemanticObject, artifacts: SourceArtifact[], command: string): AcceptanceCriterion[] {
  const targetIds = artifacts.filter((item) => item.role === "target").map((item) => item.id);
  const criteria: AcceptanceCriterion[] = [
    { id: "SEM-USER-GOAL", title: "用户真实目标", requirement: `最终成果必须实质满足用户要求：${command || object.primaryOutcome}`, source: "user-command", weight: 30, hardGate: true, judgeType: "llm", validationMethod: "user-scenario", minScore: 90, evidenceExpected: ["最终成果中可定位到与用户要求直接对应的变化"], protectedConstraint: false, artifactIds: targetIds, category: "outcome" },
    { id: "SEM-BUSINESS-OUTCOME", title: `${object.label}核心效果`, requirement: object.primaryOutcome, source: "source-understanding", weight: 20, hardGate: true, judgeType: "llm", validationMethod: "semantic-judge", minScore: 88, evidenceExpected: ["成果在真实业务使用场景中的改进证据"], protectedConstraint: false, artifactIds: targetIds, category: "artifact-specific" },
    { id: "SEM-FORMAT", title: "原格式与可交付性", requirement: "每个目标成果必须保持其原始交付格式/容器，无法高保真回写的格式必须明确阻止交付。", source: "system-integrity", weight: 15, hardGate: true, judgeType: "integrity", validationMethod: "format-roundtrip", minScore: 100, evidenceExpected: ["原格式文件可打开", "未修改内容/文件树保持"], protectedConstraint: true, artifactIds: targetIds, category: "integrity" },
  ];
  if (targetIds.length > 1 || object.crossArtifactRequirements.length) criteria.push({
    id: "SEM-CROSS-CONSISTENCY", title: "跨成果一致性", requirement: object.crossArtifactRequirements.join("；") || "多个成果物中的事实、数字、术语、状态和结论必须相互一致。", source: "source-understanding", weight: 20, hardGate: true, judgeType: "pairwise", validationMethod: "cross-artifact", minScore: 92, evidenceExpected: ["跨成果共享字段/事实的一致性检查"], protectedConstraint: false, artifactIds: targetIds, category: "artifact-specific",
  });
  criteria.push({ id: "SEM-INTEGRITY", title: "成果完整性", requirement: "最终成果必须完整、无截断、无占位、无未处理 TODO，并保留未授权删除的内容。", source: "system-integrity", weight: targetIds.length > 1 ? 15 : 35, hardGate: true, judgeType: "integrity", validationMethod: "static-structure", minScore: 95, evidenceExpected: ["完整成果快照", "结构/文件清单完整性"], protectedConstraint: true, artifactIds: targetIds, category: "integrity" });
  const rawTotal = criteria.reduce((sum, item) => sum + item.weight, 0) || 100;
  const normalized = criteria.map((item) => ({ ...item, weight: Number((item.weight / rawTotal * 100).toFixed(2)) }));
  const drift = Number((100 - normalized.reduce((sum, item) => sum + item.weight, 0)).toFixed(2));
  if (normalized.length && Math.abs(drift) >= 0.01) normalized[0] = { ...normalized[0]!, weight: Number((normalized[0]!.weight + drift).toFixed(2)) };
  return normalized;
}

export function compileSemanticEvolution(args: { artifacts: SourceArtifact[]; command: string; aiSemanticObject?: Partial<SemanticObject>; aiWorkflowStages?: SemanticEvolution["workflowStages"] }): { artifactGraph: ArtifactGraph; semanticEvolution: SemanticEvolution } {
  const graph = buildArtifactGraph(args.artifacts);
  const fallback = heuristicSemanticObject(args.artifacts, args.command, graph);
  const structureScore = softwareStructureScore(args.artifacts, graph);
  const explicitNotSoftware = /不是(?:软件|代码|项目)|不要当成(?:软件|代码)|非代码|并非(?:软件|代码)/i.test(args.command);
  const lockSoftwareObject = fallback.typeId === "software-system" && structureScore >= 4 && !explicitNotSoftware;
  const aiCompatible = !args.aiSemanticObject?.typeId || !lockSoftwareObject || args.aiSemanticObject.typeId === "software-system";
  const aiObject = aiCompatible ? (args.aiSemanticObject ?? {}) : {};
  const object: SemanticObject = {
    ...fallback,
    ...aiObject,
    componentArtifactIds: aiObject.componentArtifactIds?.length ? aiObject.componentArtifactIds : fallback.componentArtifactIds,
    crossArtifactRequirements: aiObject.crossArtifactRequirements?.length ? aiObject.crossArtifactRequirements : fallback.crossArtifactRequirements,
    reasoning: [...fallback.reasoning, ...(aiCompatible ? (args.aiSemanticObject?.reasoning ?? []) : [`忽略与工程结构冲突的 AI 语义分类：${args.aiSemanticObject?.typeId ?? "unknown"}`])].slice(0,8),
  };
  const intent = intentFromCommand(args.command, object, args.artifacts);
  const workflowStages = args.aiWorkflowStages?.length === 6 && aiCompatible ? args.aiWorkflowStages : workflowForSemantic(object, object.componentArtifactIds);
  const acceptanceRubric = semanticAcceptanceCriteria(object, args.artifacts, args.command);
  return {
    artifactGraph: graph,
    semanticEvolution: {
      semanticObject: object,
      intent,
      workflowLabel: `${object.label} · 自适应进化流程`,
      workflowSummary: `统一六步主流程不变，但内部动作由“${object.label}”业务对象、用户意图和实际成果结构动态编译。`,
      workflowStages,
      acceptanceRubric,
      needsReview: object.confidence < 0.68,
      warnings: object.confidence < 0.68 ? ["业务对象识别置信度较低，请在项目内确认“这套成果实际是什么”。"] : [],
      version: 1,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function resolveSemanticWorkflow(project: Pick<EvolveProject, "sourceArtifacts" | "semanticEvolution">) {
  if (project.semanticEvolution?.workflowStages?.length === 6) return project.semanticEvolution;
  return compileSemanticEvolution({ artifacts: project.sourceArtifacts, command: "" }).semanticEvolution;
}
