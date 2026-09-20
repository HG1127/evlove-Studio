import type { AcceptanceCriterion, ArtifactDescriptor, ArtifactKind, EvolveProject, SourceArtifact, Stage } from "@evolution/contracts";

export type AdaptiveStageId = "define" | "baseline" | "diagnose" | "evolve" | "verify" | "deliver";
export type AdaptiveStageSpec = {
  id: AdaptiveStageId;
  label: string;
  entry: Stage;
  stages: Stage[];
  flow: string;
  input: string;
  action: string;
  output: string;
  done: string;
};

export type ArtifactEvolutionStrategy = {
  id: string;
  kind: ArtifactKind | "mixed";
  label: string;
  shortLabel: string;
  description: string;
  mutationMode: string;
  validationMode: string;
  outputMode: string;
  userGoalBudget: number;
  artifactBudget: number;
  systemBudget: number;
  stages: AdaptiveStageSpec[];
  criteria: (artifact: SourceArtifact, index: number) => AcceptanceCriterion[];
};

function extOf(artifact: Pick<SourceArtifact, "extension" | "name">) {
  return (artifact.extension || artifact.name.split(".").pop() || "").toLowerCase();
}

function includesAny(values: string[], patterns: RegExp[]) {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

export function describeArtifact(input: Pick<SourceArtifact, "name" | "mimeType" | "extension" | "artifactKind" | "structure" | "structuredContent">): ArtifactDescriptor {
  const extension = extOf(input);
  const structure = input.structure ?? [];
  const mime = input.mimeType ?? "";
  const kind = input.artifactKind;

  if (extension === "pptx") return {
    family: "presentation", subtype: "pptx", adapterId: "presentation-pptx-ooxml", confidence: 0.99,
    preservationMode: "same-package", fidelity: "high", formatExtension: "pptx", editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: false, visual: true },
    evolutionDimensions: ["逐页内容覆盖", "章节与叙事结构", "导航与信息层级", "表达清晰度", "文本长度与版式适配", "原模板/页结构保留"],
    requiredValidations: ["页数/页序完整", "所有关键页可定位", "文本 run 可回写", "原 PPTX 包结构 可重新打开", "用户要求逐条覆盖"],
    limitations: ["V2.4 保留原 PPTX 主题、版式与可编辑结构；复杂图表/SmartArt/几何重排仍需要视觉渲染器 扩展。"],
  };
  if (["ppt", "odp"].includes(extension) || kind === "presentation") return {
    family: "presentation", subtype: extension || "presentation", adapterId: "presentation-generic", confidence: 0.9,
    preservationMode: extension === "odp" ? "same-package" : "external-required", fidelity: extension === "odp" ? "medium" : "limited", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: extension === "odp", validateStructure: true, execute: false, visual: true },
    evolutionDimensions: ["逐页内容覆盖", "叙事结构", "表达清晰度", "格式保真"],
    requiredValidations: ["页级结构完整", "用户要求覆盖", "原格式输出能力"],
    limitations: extension === "ppt" ? ["旧版 .ppt 为 OLE 二进制格式；没有外部 Office 渲染器 时不能保证同格式高保真重写。建议另存为 .pptx。"] : [],
  };
  if (extension === "docx") return {
    family: "text", subtype: "docx", adapterId: "document-docx-ooxml", confidence: 0.99,
    preservationMode: "same-package", fidelity: "high", formatExtension: "docx", editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: false, visual: false },
    evolutionDimensions: ["章节完整性", "内容深度", "结构层级", "术语一致性", "可读性", "原样式/段落结构保留"],
    requiredValidations: ["正文结构完整", "无截断/占位", "原 DOCX 包结构 可打开", "受保护章节未破坏", "用户要求覆盖"],
    limitations: ["复杂浮动对象、域代码和图文混排仅保证不主动删除；V2.4 主要对文本 run 进行同包回写。"],
  };
  if (extension === "pdf") return {
    family: "fixed-layout", subtype: "pdf", adapterId: "document-pdf-readonly", confidence: 0.99,
    preservationMode: "external-required", fidelity: "limited", formatExtension: "pdf", editable: false,
    capabilities: { parse: true, mutate: true, materialize: false, validateStructure: true, execute: false, visual: true },
    evolutionDimensions: ["内容覆盖", "结构", "可读性", "视觉/版面意图"],
    requiredValidations: ["不得伪造同格式交付", "若无 PDF 渲染器 必须阻止 Artifact Ready"],
    limitations: ["PDF 是固定版式结果格式。当前内置 Runtime 可读取并评价，但没有高保真 PDF 重排引擎；需要外部 PDF 渲染器 才能同格式交付。"],
  };
  // Explicit semantic kinds must win over extension-only document routing. A prompt.md or knowledge.md
  // is not a generic document: its mutation/evaluation contract is materially different.
  if (kind === "prompt" || /prompt|system-prompt|instruction/i.test(input.name)) return {
    family: "text", subtype: "prompt", adapterId: "prompt-text", confidence: 0.96,
    preservationMode: "same-text-format", fidelity: "full", formatExtension: extension || "txt", editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: true, visual: false },
    evolutionDimensions: ["指令覆盖", "约束层级", "输出契约", "鲁棒性", "边界场景", "简洁性"],
    requiredValidations: ["受保护指令未丢失", "输出格式不破坏", "未知题表现提升", "无互相冲突指令"], limitations: [],
  };
  if (kind === "knowledge" || /knowledge|kb|知识库|语料|corpus/i.test(input.name)) return {
    family: "knowledge", subtype: extension || "knowledge", adapterId: "knowledge-corpus", confidence: 0.92,
    preservationMode: "same-text-format", fidelity: "high", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: true, visual: false },
    evolutionDimensions: ["知识覆盖", "来源保真", "可检索结构", "去重", "元数据", "时效性"],
    requiredValidations: ["关键知识条目不丢失", "不引入无来源事实", "来源关系可追踪", "检索结构可用"], limitations: [],
  };
  if (["md", "mdx", "txt", "html", "htm", "rtf", "odt", "doc"].includes(extension) || kind === "document") return {
    family: "text", subtype: extension || "document", adapterId: "document-structured-text", confidence: 0.92,
    preservationMode: ["md", "mdx", "txt", "html", "htm"].includes(extension) ? "same-text-format" : "same-format-rebuild",
    fidelity: ["md", "mdx", "txt", "html", "htm"].includes(extension) ? "full" : "medium", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: !["doc"].includes(extension), validateStructure: true, execute: false, visual: false },
    evolutionDimensions: ["要求覆盖", "章节结构", "内容深度", "一致性", "无截断", "原格式"],
    requiredValidations: ["章节/结构完整", "要求覆盖", "无 TODO/占位", "格式可交付"],
    limitations: extension === "doc" ? ["旧版 .doc 无内置高保真 Writer；建议转 .docx。"] : [],
  };
  if (["xlsx", "xls", "ods", "csv", "tsv"].includes(extension) || kind === "spreadsheet") return {
    family: "spreadsheet", subtype: extension || "spreadsheet", adapterId: extension === "xlsx" ? "spreadsheet-xlsx" : "spreadsheet-generic", confidence: 0.98,
    preservationMode: ["csv", "tsv"].includes(extension) ? "same-text-format" : "same-format-rebuild", fidelity: extension === "xlsx" ? "high" : "medium", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: true, visual: false },
    evolutionDimensions: ["Sheet/表结构", "字段与类型", "公式/计算正确性", "数据完整性", "可用性", "原格式"],
    requiredValidations: ["Sheet/列不丢失", "公式/关键数据关系正确", "可重新打开", "用户要求覆盖"],
    limitations: ["复杂宏、外部连接、图表样式的完全保真需要 Office 专用 渲染器；基础表格/公式/数据结构可保留与验证。"],
  };
  const codeSignals = includesAny(structure, [/(^|\/)package\.json$/i, /(^|\/)src\//i, /(^|\/)app\//i, /(^|\/)pyproject\.toml$/i, /(^|\/)requirements\.txt$/i, /(^|\/)go\.mod$/i, /(^|\/)cargo\.toml$/i]);
  if (extension === "zip" && (kind === "codebase" || codeSignals)) return {
    family: "codebase", subtype: "zip-repository", adapterId: "codebase-zip-repository", confidence: 0.98,
    preservationMode: "same-package", fidelity: "high", formatExtension: "zip", editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: true, visual: includesAny(structure, [/components\//i, /pages\//i, /app\//i]) },
    evolutionDimensions: ["需求实现", "文件/模块完整性", "类型/构建", "测试", "接口契约兼容", "回归", "可维护性", "原 ZIP 文件树"],
    requiredValidations: ["文件树完整", "关键契约保留", "无缺失 import/引用", "测试/类型检查可执行", "未修改文件保留", "输出仍为 ZIP"],
    limitations: ["浏览器原型会按需从原 ZIP 读取相关源码并回写修改文件；真正 build/test 应在后端 Git worktree / sandbox 中执行。"],
  };
  if (["js", "jsx", "ts", "tsx", "py", "go", "rs", "java", "kt", "php", "sql", "vue", "svelte"].includes(extension) || kind === "codebase") return {
    family: "codebase", subtype: extension || "source-code", adapterId: "code-file", confidence: 0.97,
    preservationMode: "same-text-format", fidelity: "full", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: true, visual: false },
    evolutionDimensions: ["功能正确性", "接口兼容", "类型/语法", "测试", "可维护性", "用户需求"],
    requiredValidations: ["语法/类型可验证", "受保护接口未破坏", "用户需求覆盖"], limitations: [],
  };
  if (["json", "yaml", "yml"].includes(extension) && (kind === "workflow" || /workflow|dag|node|edge|state|pipeline/i.test(input.name))) return {
    family: "workflow", subtype: extension, adapterId: "workflow-structured", confidence: 0.96,
    preservationMode: "same-text-format", fidelity: "full", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: true, visual: false },
    evolutionDimensions: ["节点完整性", "状态流转", "输入输出契约", "异常/重试/回滚", "工具绑定", "幂等性", "可观测性"],
    requiredValidations: ["无悬空节点/边", "异常路径闭环", "输入输出可衔接", "Schema 可解析", "用户目标覆盖"], limitations: [],
  };
  if (mime.startsWith("image/") || kind === "image") return {
    family: "image", subtype: extension || "image", adapterId: "image-external", confidence: 0.99,
    preservationMode: "external-required", fidelity: "limited", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: false, validateStructure: false, execute: false, visual: true },
    evolutionDimensions: ["视觉目标", "文本/主体保真", "布局", "风格", "原格式"],
    requiredValidations: ["视觉结果与目标一致", "原主体/文本保护", "同格式输出"],
    limitations: ["当前 Studio Runtime 没有内置图像生成/编辑 渲染器；需要连接视觉 Artifact Plugin 才能产出真实同格式图片。"],
  };
  if (mime.startsWith("audio/") || mime.startsWith("video/") || kind === "media" || ["mp3","wav","ogg","m4a","mp4","mov","avi","webm"].includes(extension)) return {
    family: "media", subtype: extension || "media", adapterId: "media-external", confidence: 0.96,
    preservationMode: "external-required", fidelity: "limited", formatExtension: extension, editable: true,
    capabilities: { parse: false, mutate: true, materialize: false, validateStructure: true, execute: false, visual: mime.startsWith("video/") },
    evolutionDimensions: ["内容结构", "脚本/字幕", "时长与节奏", "音画一致性", "主体/品牌保护", "原格式"],
    requiredValidations: ["用户目标逐项覆盖", "时序/字幕/结构约束", "受保护元素保持", "同格式 渲染器"],
    limitations: ["当前 Studio Runtime 能识别媒体类型并编译专属标准，但没有内置转写/剪辑/编码 渲染器；接入 Media Artifact Plugin 前会阻止假同格式交付。"],
  };
  if (extension === "zip") return {
    family: "package", subtype: "zip-package", adapterId: "package-zip-generic", confidence: 0.72,
    preservationMode: "same-package", fidelity: "medium", formatExtension: "zip", editable: true,
    capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: false, visual: false },
    evolutionDimensions: ["包内容覆盖", "文件结构", "目标文件修改", "未修改文件保留", "原格式"],
    requiredValidations: ["ZIP 可打开", "原文件树不被无授权删除", "目标修改可定位"],
    limitations: ["若 ZIP 不是代码工程，系统会以 Package Adapter 处理；未知二进制子文件只能保留，不能自动语义修改。"],
  };
  return {
    family: "generic", subtype: extension || "generic", adapterId: "generic-safe", confidence: 0.55,
    preservationMode: input.artifactKind === "generic" && !extension ? "external-required" : "same-text-format", fidelity: "medium", formatExtension: extension, editable: true,
    capabilities: { parse: true, mutate: true, materialize: Boolean(extension), validateStructure: true, execute: false, visual: false },
    evolutionDimensions: ["用户要求覆盖", "完整性", "一致性", "原格式"],
    requiredValidations: ["用户要求逐条覆盖", "成果完整", "格式可交付"],
    limitations: ["这是通用安全适配器。系统会保留原格式/原包并仅修改可理解部分；若无法保证同格式物化，会阻止最终交付而不是伪造成功。"],
  };
}

function criterion(id: string, title: string, requirement: string, evidence: string[], artifact: SourceArtifact, weight: number, judgeType: AcceptanceCriterion["judgeType"] = "structural", hardGate = true, category: AcceptanceCriterion["category"] = "artifact-specific"): AcceptanceCriterion {
  const validationMethod: AcceptanceCriterion["validationMethod"] = id.endsWith("-FORMAT") ? "format-roundtrip" : judgeType === "structural" || judgeType === "integrity" ? "static-structure" : judgeType === "pairwise" ? "semantic-judge" : "semantic-judge";
  return { id, title, requirement, source: "system-integrity", weight, hardGate, judgeType, validationMethod, minScore: hardGate ? 90 : 82, evidenceExpected: evidence, protectedConstraint: false, artifactIds: [artifact.id], category };
}

function criteriaForDescriptor(artifact: SourceArtifact, index: number): AcceptanceCriterion[] {
  const d = artifact.artifactDescriptor ?? describeArtifact(artifact);
  const p = `ART-${index + 1}`;
  const base格式 = criterion(`${p}-FORMAT`, `${artifact.name} · 原格式交付`, `最终成果必须继续以 .${d.formatExtension || "原"} 格式交付，且不能用 Markdown/纯文本摘要冒充原成果物。`, ["最终文件扩展名与原文件一致", `成果生成器=${d.adapterId}`, "下载后能由对应原生应用打开"], artifact, 12, "integrity", true, "integrity");
  if (!d.capabilities.materialize || d.preservationMode === "external-required") {
    base格式.requirement += ` 当前内置适配器不能高保真生成该格式；在未连接外部渲染器前，这条硬门槛必须保持失败，禁止伪造交付。`;
    base格式.evidenceExpected.push(...d.limitations);
  }
  switch (d.family) {
    case "codebase": return [
      { ...criterion(`${p}-ENGINEERING`, `${artifact.name} · 工程完整与同格式交付`, `最终成果必须仍是完整的 .${d.formatExtension || "zip"} 工程；保留文件树、关键入口、构建配置和未授权内容，不能用 Markdown/片段冒充。`, ["原/新文件清单", "package/entry/config 保留", "关键源码文件存在", "原 ZIP 可重新打开"], artifact, 20, "integrity"), validationMethod: "format-roundtrip" },
      { ...criterion(`${p}-REGRESSION`, `${artifact.name} · 契约与回归`, "与用户目标相关的实现必须可在源码/测试中定位；现有 API、Schema、公共类型和已通过关键路径不得无授权退化。真实构建/E2E 未连接 Runner 时只能标记为未验证，不能伪造 PASS。", ["公共契约 diff", "相关实现证据", "测试/检查证据", "真实 Runner 状态"], artifact, 18, "structural"), validationMethod: "static-structure" },
    ];
    case "presentation": return [
      base格式,
      criterion(`${p}-SLIDES`, `${artifact.name} · 页级完整性`, "每个关键章节和原有必要页面都必须保留或被有依据地重组；不能把整份演示压成几页摘要。", ["页数/章节映射", "逐页覆盖矩阵", "关键页面无缺失"], artifact, 14, "structural"),
      criterion(`${p}-STORY`, `${artifact.name} · 叙事与导航`, "演示必须形成清楚的上下游、章节层级和阅读导航，且每页只解决清晰问题。", ["章节顺序", "导航/标题层级", "前后页逻辑"], artifact, 10, "llm", false, "ux"),
      criterion(`${p}-EDITABLE`, `${artifact.name} · 可编辑性`, "输出必须保持可编辑 PPT 结构，原主题/布局对象不能被无授权扁平化成图片或纯文本。", ["PPTX OOXML 可正常打开", "页面/文本运行结构保留", "未扁平化"], artifact, 10, "integrity"),
    ];
    case "spreadsheet": return [
      base格式,
      criterion(`${p}-SHEETS`, `${artifact.name} · Sheet/字段结构`, "必要 Sheet、字段、行列关系和数据类型必须保留；不得把表格退化为文字说明。", ["Sheet 列表", "字段/列结构", "类型/关键数据未丢失"], artifact, 14, "structural"),
      criterion(`${p}-FORMULA`, `${artifact.name} · 公式与计算`, "现有关键公式/计算逻辑必须正确保留或按用户目标升级，不能静默改成错误静态值。", ["关键公式/计算结果", "引用关系", "边界数据验证"], artifact, 12, "integrity"),
      criterion(`${p}-USABILITY`, `${artifact.name} · 业务可用性`, "进化后的表格必须更容易完成用户目标，包括筛选、字段可理解性、异常值处理或统计口径。", ["业务操作路径", "字段说明", "异常/空值处理"], artifact, 8, "llm", false, "ux"),
    ];
    case "workflow": return [
      base格式,
      criterion(`${p}-GRAPH`, `${artifact.name} · 流程图完整性`, "节点、连线、状态和 Gate 必须形成可执行闭环，不得存在悬空节点或无出口状态。", ["节点/连线图", "终止状态", "所有输入都有下游"], artifact, 16, "structural"),
      criterion(`${p}-ERROR`, `${artifact.name} · 异常与恢复`, "失败、超时、重试、回滚和权限不足等异常路径必须有明确行为。", ["error paths", "retry/rollback", "失败状态可观测"], artifact, 12, "structural"),
      criterion(`${p}-CONTRACT`, `${artifact.name} · 节点输入输出契约`, "上一步产出必须能成为下一步输入，节点间字段/Schema/工具调用必须一致。", ["输入/输出契约", "字段/Schema 映射", "工具绑定"], artifact, 12, "integrity"),
    ];
    case "text": {
      if (d.subtype === "prompt") return [
        base格式,
        criterion(`${p}-INSTRUCTION`, `${artifact.name} · 指令与约束`, "用户目标、角色、边界、禁止事项和输出契约必须在进化后的 Prompt 中清晰且不冲突。", ["目标/边界可定位", "输出 schema 保留", "冲突指令已消除"], artifact, 16, "pairwise"),
        criterion(`${p}-ROBUST`, `${artifact.name} · 未知场景鲁棒性`, "Prompt 不能只对已知样例调优；对缺失信息、边界输入和异常情况也要有稳定策略。", ["未知场景测试", "边界场景", "不确定信息处理"], artifact, 12, "llm"),
      ];
      return [
        base格式,
        criterion(`${p}-STRUCTURE`, `${artifact.name} · 结构完整`, "章节、标题层级、必要内容和顺序必须完整，不能出现截断、空章节或占位符。", ["章节/标题 map", "无 TODO/占位", "首尾完整"], artifact, 14, "structural"),
        criterion(`${p}-DEPTH`, `${artifact.name} · 内容深度与一致性`, "内容应围绕用户真实目标充分展开，关键概念、术语和结论保持一致，不能只做表面扩写。", ["关键要求覆盖", "跨章节一致性", "结论有支撑"], artifact, 10, "llm", false),
      ];
    }
    case "knowledge": return [
      base格式,
      criterion(`${p}-COVERAGE`, `${artifact.name} · 知识覆盖`, "关键知识条目、来源关系和必要上下文不得因进化丢失。", ["条目覆盖率", "来源映射", "缺失清单"], artifact, 14, "integrity"),
      criterion(`${p}-FIDELITY`, `${artifact.name} · 来源保真`, "不得新增无来源事实；清理、合并或改写后仍应能追溯原始来源。", ["来源标识", "事实对照", "无无来源新增"], artifact, 12, "pairwise"),
    ];
    case "image": return [base格式, criterion(`${p}-VISUAL`, `${artifact.name} · 视觉目标`, "视觉成果必须满足用户对主体、文字、布局和风格的具体要求，同时保护明确要求保持不变的视觉元素。", ["视觉对比", "文字/主体保留", "目标变化可见"], artifact, 18, "pairwise")];
    case "media": return [
      base格式,
      criterion(`${p}-MEDIA-CONTENT`, `${artifact.name} · 媒体内容目标`, "音视频成果必须满足用户对脚本、结构、时长、字幕、节奏或音画关系的具体要求，不能只返回文字方案。", ["媒体成品或 渲染器 输出", "脚本/字幕/段落结构对照", "用户目标逐项覆盖"], artifact, 16, "pairwise"),
      criterion(`${p}-MEDIA-PROTECT`, `${artifact.name} · 主体与品牌保护`, "未经授权不得改变受保护主体、品牌元素、关键音轨或必要片段。", ["原版与进化版媒体对比", "受保护元素保持"], artifact, 12, "pairwise"),
    ];
    case "fixed-layout": return [base格式, criterion(`${p}-CONTENT`, `${artifact.name} · 固定版式内容`, "内容改进必须可落回固定版式成果；若当前 Runtime 无法高保真重建，则应阻止交付并建议可编辑源格式。", ["内容覆盖", "版式能力说明", "渲染器状态"], artifact, 16, "integrity")];
    case "package": return [base格式, criterion(`${p}-TREE`, `${artifact.name} · 包结构完整`, "ZIP 中未授权修改的文件必须原样保留，目标文件修改可定位，包结构仍然完整。", ["进化前后文件清单", "已修改文件", "un已修改文件 preserved"], artifact, 14, "integrity")];
    default: return [base格式, criterion(`${p}-COMPLETE`, `${artifact.name} · 成果完整`, "最终成果必须是完整可交付对象，并逐条满足用户要求；无法同格式物化时必须明确阻止交付。", ["完整成果", "要求覆盖矩阵", "同格式输出"], artifact, 16, "integrity")];
  }
}

const commonStageMeta: Record<AdaptiveStageId, Pick<AdaptiveStageSpec, "entry" | "stages">> = {
  define: { entry: "target", stages: ["target"] }, baseline: { entry: "baseline", stages: ["baseline"] }, diagnose: { entry: "problem", stages: ["problem", "diagnosis"] }, evolve: { entry: "plan", stages: ["plan", "experiment"] }, verify: { entry: "validation", stages: ["validation"] }, deliver: { entry: "release", stages: ["release", "learning"] },
};
function stage(id: AdaptiveStageId, label: string, flow: string, input: string, action: string, output: string, done: string): AdaptiveStageSpec { return { id, label, ...commonStageMeta[id], flow, input, action, output, done }; }

function adaptiveLabels(label: string) {
  if (/代码/.test(label)) return { define:"需求契约", baseline:"工程体检", diagnose:"缺陷定位", evolve:"构建候选", verify:"测试验收", deliver:"工程交付" };
  if (/演示|PPT/.test(label)) return { define:"目标与结构", baseline:"逐页体检", diagnose:"叙事诊断", evolve:"演示重构", verify:"页级验收", deliver:"演示交付" };
  if (/表格/.test(label)) return { define:"目标与口径", baseline:"工作簿体检", diagnose:"数据诊断", evolve:"表格重构", verify:"公式验收", deliver:"表格交付" };
  if (/工作流/.test(label)) return { define:"流程目标", baseline:"流程体检", diagnose:"卡点定位", evolve:"流程重构", verify:"闭环验收", deliver:"流程交付" };
  if (/Prompt/.test(label)) return { define:"目标与约束", baseline:"指令基线", diagnose:"失败诊断", evolve:"指令进化", verify:"未知题验收", deliver:"指令交付" };
  if (/知识/.test(label)) return { define:"知识目标", baseline:"知识体检", diagnose:"缺口诊断", evolve:"知识重构", verify:"来源验收", deliver:"知识交付" };
  if (/视觉/.test(label)) return { define:"视觉目标", baseline:"视觉基线", diagnose:"视觉诊断", evolve:"视觉重构", verify:"视觉验收", deliver:"图片交付" };
  if (/音视频|媒体/.test(label)) return { define:"媒体目标", baseline:"媒体基线", diagnose:"内容诊断", evolve:"媒体重构", verify:"媒体验收", deliver:"媒体交付" };
  if (/固定版式|PDF/.test(label)) return { define:"内容与版式", baseline:"页面体检", diagnose:"版式诊断", evolve:"内容重构", verify:"版式验收", deliver:"PDF 交付" };
  if (/文档/.test(label)) return { define:"写作目标", baseline:"文档体检", diagnose:"内容诊断", evolve:"文档重构", verify:"成果验收", deliver:"文档交付" };
  if (/复合/.test(label)) return { define:"整体契约", baseline:"多成果体检", diagnose:"交叉诊断", evolve:"分类型进化", verify:"联合验收", deliver:"打包交付" };
  if (/ZIP/.test(label)) return { define:"包目标", baseline:"文件树体检", diagnose:"目标文件定位", evolve:"包内进化", verify:"包完整验收", deliver:"ZIP 交付" };
  return { define:"目标契约", baseline:"原版体检", diagnose:"问题定位", evolve:"结构进化", verify:"成果验收", deliver:"原格式交付" };
}
function stagesFor(label: string, terms: { baseline: string; diagnose: string; evolve: string; verify: string; deliver: string }): AdaptiveStageSpec[] {
  const labels=adaptiveLabels(label);
  return [
    stage("define", labels.define, `${label} → 目标 + 专属验收标准`, `原始${label}、参考材料、用户进化要求`, "识别真实类型/结构、保护边界和格式能力；编译该类型专属验收标准", "进化契约 + 自适应策略 + 专属验收标准", "用户能说清楚要变什么、不能变什么、什么叫通过"),
    stage("baseline", labels.baseline, terms.baseline, `当前完整${label} + 该类型测试标准`, `按专用适配器读取原生结构并运行/审阅当前版本`, "基线结果 + 运行轨迹/结构检查 + 问题证据", "已知道当前版本在哪些专属标准上不足"),
    stage("diagnose", labels.diagnose, terms.diagnose, "基线失败证据 + 成功/失败运行轨迹/结构差异", "区分“看到的问题”和“为什么发生”；只对高影响问题做可证伪根因", "目标问题 + 根因 + 支持证据 + 反证条件", "问题和原因明确分开，根因可被证伪"),
    stage("evolve", labels.evolve, terms.evolve, `根因 + 原始${label}结构 + 保护约束`, "生成多种候选，并用该类型构建器生成真实新版成果", `多个完整候选 ${label} 快照`, "每个候选都是可评测的真实成果，不是修改建议"),
    stage("verify", labels.verify, terms.verify, `真实候选 ${label} + 未知题 + 专属验收标准`, "先跑关键硬门槛，再跑质量标准；失败只修复未通过项", "已验收候选快照 + 要求覆盖矩阵", "同一个被测试成果通过用户目标、结构完整性和格式保真"),
    stage("deliver", labels.deliver, terms.deliver, "已验收的同一份成果快照", "用原格式输出器回写/重建，不重新生成另一份内容；必要时发布/沉淀经验", `同格式进化成果 + 验收报告 + 版本记录`, "下载到的就是被验收过的同一个成果"),
  ];
}

function profileForDescriptor(descriptor: ArtifactDescriptor): Omit<ArtifactEvolutionStrategy, "criteria"> {
  const common = { userGoalBudget: 60, artifactBudget: 30, systemBudget: 10 };
  switch (descriptor.family) {
    case "codebase": return { ...common, userGoalBudget: 50, artifactBudget: 40, id: descriptor.adapterId, kind: "codebase", label: "代码工程", shortLabel: "代码", description: "按文件/模块理解与修改，候选必须是完整工程快照；最终回写原 ZIP。", mutationMode: "文件级/模块级变异 + 补丁/文件映射", validationMode: "契约 + 类型/构建 + 测试 + 未知题 + 回归", outputMode: "原 ZIP + 修改文件回写", stages: stagesFor("代码工程", { baseline: "当前工程 → 文件/契约/测试基线", diagnose: "失败测试/运行 Trace → 模块根因", evolve: "根因 → 源码候选 → 工程快照竞争", verify: "未知题 + 构建/测试 + 契约 + 专属验收", deliver: "已验收工程快照 → 原 ZIP 回写" }) };
    case "presentation": return { ...common, id: descriptor.adapterId, kind: "presentation", label: "演示文稿", shortLabel: "PPT", description: "按页面/文本运行结构理解，按叙事和页级目标进化；最终写回原演示格式。", mutationMode: "逐页/章节蓝图 + OOXML 文本运行结构", validationMode: "页级覆盖 + 叙事 + 可编辑性 + 验收标准", outputMode: "原 PPTX/演示格式回写", stages: stagesFor("演示文稿", { baseline: "逐页结构 → 内容/导航/表达基线", diagnose: "页级症状 → 内容/叙事/信息架构原因", evolve: "根因 → 逐页候选蓝图 → 候选演示文稿", verify: "页级硬门槛 + 叙事 + 可编辑性 + 用户要求", deliver: "已验收页面快照 → 原演示文件回写" }) };
    case "spreadsheet": return { ...common, userGoalBudget: 55, artifactBudget: 35, id: descriptor.adapterId, kind: "spreadsheet", label: "表格/工作簿", shortLabel: "表格", description: "按工作表/字段/公式理解，保持数据关系并输出同格式工作簿。", mutationMode: "工作表/单元格/公式蓝图", validationMode: "数据/公式/工作表结构 + 业务规则 + 验收标准", outputMode: "同格式 工作簿", stages: stagesFor("表格", { baseline: "工作表/字段/公式 → 数据结构基线", diagnose: "异常/低效 → 字段/公式/流程原因", evolve: "根因 → 工作表/单元格/公式候选", verify: "公式/数据完整性 + 业务口径 + 未知题", deliver: "已验收工作簿 → 同格式文件" }) };
    case "workflow": return { ...common, userGoalBudget: 55, artifactBudget: 35, id: descriptor.adapterId, kind: "workflow", label: "工作流", shortLabel: "流程", description: "按节点、边、状态、关卡和异常路径进化，不把 Workflow 当文章改写。", mutationMode: "节点/连线/状态/契约变异", validationMode: "图完整性 + 状态流转 + 异常路径 + 验收标准", outputMode: "同 JSON/YAML 工作流", stages: stagesFor("工作流", { baseline: "节点/边/状态 → 可执行流程基线", diagnose: "流程症状 → 节点/契约/异常路径根因", evolve: "根因 → 图结构候选 → 工作流竞争", verify: "图完整性 + 状态/契约 + 未知题", deliver: "已验收工作流 → 同格式 JSON/YAML" }) };
    case "knowledge": return { ...common, id: descriptor.adapterId, kind: "knowledge", label: "知识库/语料", shortLabel: "知识", description: "按知识条目、来源和可检索结构进化，重点保护来源保真。", mutationMode: "知识块/条目/元数据/索引变异", validationMode: "覆盖率 + 来源保真 + 检索结构 + 验收标准", outputMode: "同格式知识成果", stages: stagesFor("知识库", { baseline: "知识条目/来源 → 覆盖与检索基线", diagnose: "遗漏/冲突 → 知识结构/来源根因", evolve: "根因 → 条目/索引候选", verify: "覆盖率 + 来源保真 + 未知题", deliver: "已验收知识快照 → 原格式" }) };
    case "image": return { ...common, id: descriptor.adapterId, kind: "image", label: "图片/视觉成果", shortLabel: "视觉", description: "视觉进化需要视觉渲染器；没有 渲染器 时系统只分析和生成修改方案，不会伪造已完成图片。", mutationMode: "视觉编辑方案 / 外部渲染器", validationMode: "视觉对比 + 文字/主体保护 + 专属验收", outputMode: "同格式图片（需要视觉插件）", stages: stagesFor("视觉成果", { baseline: "原图 → 主体/文字/布局基线", diagnose: "视觉问题 → 布局/表达/风格原因", evolve: "根因 → 视觉候选 / 渲染器", verify: "视觉对比 + 受保护元素", deliver: "已验收图片 → 同格式图片" }) };
    case "media": return { ...common, id: descriptor.adapterId, kind: "media", label: "音视频成果", shortLabel: "媒体", description: "按脚本、时序、字幕、音画结构和保护元素建立专属进化标准；没有 媒体渲染器 时不会伪造同格式成品。", mutationMode: "脚本/时间线/字幕/剪辑计划 + 外部渲染器", validationMode: "媒体内容覆盖 + 时序/保护元素 + 专属验收", outputMode: "同格式音视频（需要媒体插件）", stages: stagesFor("音视频成果", { baseline: "原媒体 → 时长/脚本/字幕/段落基线", diagnose: "内容问题 → 脚本/节奏/音画原因", evolve: "根因 → 媒体候选 / 渲染器", verify: "内容覆盖 + 时序 + 保护元素", deliver: "已验收媒体 → 同格式输出" }) };
    case "fixed-layout": return { ...common, id: descriptor.adapterId, kind: "document", label: "固定版式文档", shortLabel: "PDF", description: "可以读取和评价 PDF，但高保真同格式重排需要外部渲染器；未接入时不允许伪造交付。", mutationMode: "内容方案 + 外部固定版式渲染器", validationMode: "内容 + 版式能力 + 验收标准", outputMode: "同格式 PDF（需 渲染器）", stages: stagesFor("固定版式文档", { baseline: "页面内容 → 阅读/覆盖基线", diagnose: "内容/版式问题 → 根因", evolve: "根因 → 候选内容/渲染方案", verify: "内容 + 固定版式 + 原格式硬门槛", deliver: "已验收 PDF → 同格式输出" }) };
    case "text": return { ...common, userGoalBudget: descriptor.subtype === "prompt" ? 70 : 65, artifactBudget: descriptor.subtype === "prompt" ? 20 : 25, id: descriptor.adapterId, kind: descriptor.subtype === "prompt" ? "prompt" : "document", label: descriptor.subtype === "prompt" ? "提示词/指令" : "文档", shortLabel: descriptor.subtype === "prompt" ? "Prompt" : "文档", description: descriptor.subtype === "prompt" ? "按指令层级、输出契约和未知场景表现进化。" : "按章节结构和内容深度进化，保留原格式/结构。", mutationMode: descriptor.subtype === "prompt" ? "指令/区块变异" : "章节/段落变异", validationMode: descriptor.subtype === "prompt" ? "指令覆盖 + 输出契约 + 未知场景" : "要求覆盖 + 结构完整 + 成果完整性", outputMode: descriptor.preservationMode === "same-package" ? "原文档 包结构 回写" : "同文本格式", stages: stagesFor(descriptor.subtype === "prompt" ? "Prompt" : "文档", { baseline: descriptor.subtype === "prompt" ? "当前提示词 → 样例/边界表现" : "章节/内容 → 完整性基线", diagnose: descriptor.subtype === "prompt" ? "失败样例 → 指令/约束根因" : "内容症状 → 结构/深度根因", evolve: descriptor.subtype === "prompt" ? "根因 → 提示词候选 → 未知题竞争" : "根因 → 章节/段落 候选 → 完整文档", verify: descriptor.subtype === "prompt" ? "未知题 + 输出契约 + 保护指令" : "章节完整 + 用户要求 + 原格式", deliver: descriptor.subtype === "prompt" ? "已验收提示词 → 原格式" : "已验收文档 → 原格式" }) };
    case "package": return { ...common, id: descriptor.adapterId, kind: "generic", label: "ZIP 复合包", shortLabel: "ZIP", description: "保留原 ZIP 文件树，按可理解子文件做局部进化；未知二进制只保留不改。", mutationMode: "包清单 + 目标文件变异", validationMode: "文件树 + 修改定位 + 验收标准", outputMode: "原 ZIP 回写", stages: stagesFor("ZIP 包", { baseline: "文件树 → 包内容基线", diagnose: "目标问题 → 相关子文件根因", evolve: "根因 → 子文件 候选 → 包快照", verify: "文件清单 + 用户目标 + 原格式", deliver: "已验收包 → 原 ZIP" }) };
    default: return { ...common, userGoalBudget: 70, artifactBudget: 20, id: descriptor.adapterId, kind: "generic", label: "通用成果物", shortLabel: "通用", description: "使用通用安全适配器：先识别结构和格式能力，再围绕用户验收标准 进化；无法保证同格式就阻止交付。", mutationMode: "结构感知通用变异", validationMode: "用户验收标准 + 完整性 + 原版对比", outputMode: "原格式或显式阻止交付", stages: stagesFor("成果物", { baseline: "原成果 → 结构/要求基线", diagnose: "可观察问题 → 可证伪根因", evolve: "根因 → 多个真实候选成果", verify: "用户验收标准 + 成果完整性 + 原格式", deliver: "已验收快照 → 原格式" }) };
  }
}

export function resolveArtifactStrategy(artifact: SourceArtifact): ArtifactEvolutionStrategy {
  const descriptor = artifact.artifactDescriptor ?? describeArtifact(artifact);
  return { ...profileForDescriptor(descriptor), criteria: criteriaForDescriptor };
}

function semanticStrategy(project: Pick<EvolveProject, "sourceArtifacts"> & Partial<Pick<EvolveProject, "semanticEvolution">>): ArtifactEvolutionStrategy | undefined {
  const semantic = project.semanticEvolution;
  if (!semantic?.workflowStages?.length) return undefined;
  const map: Record<string,{entry:Stage;stages:Stage[]}> = {
    define:{entry:"target",stages:["target"]}, baseline:{entry:"baseline",stages:["baseline"]}, diagnose:{entry:"problem",stages:["problem","diagnosis"]},
    evolve:{entry:"plan",stages:["plan","experiment"]}, verify:{entry:"validation",stages:["validation"]}, deliver:{entry:"release",stages:["release","learning"]},
  };
  const stages: AdaptiveStageSpec[] = semantic.workflowStages.map((item) => ({ ...item, entry: map[item.id]!.entry, stages: map[item.id]!.stages }));
  return {
    id:`semantic:${semantic.semanticObject.typeId}`, kind:"mixed", label:semantic.semanticObject.label, shortLabel:semantic.semanticObject.label.slice(0,8),
    description:semantic.workflowSummary, mutationMode:`业务对象驱动 + ${semantic.intent.qualityPriorities.slice(0,2).join(" / ") || "自适应变异"}`,
    validationMode:"用户目标 + 业务对象标准 + 各格式完整性 + 跨成果一致性", outputMode:"保持每个目标成果原格式/原容器交付",
    userGoalBudget:60, artifactBudget:30, systemBudget:10, stages, criteria:criteriaForDescriptor,
  };
}

export function resolveProjectArtifactStrategy(project: Pick<EvolveProject, "sourceArtifacts"> & Partial<Pick<EvolveProject, "semanticEvolution">>): ArtifactEvolutionStrategy {
  const semantic = semanticStrategy(project);
  if (semantic) return semantic;
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  if (!targets.length) return resolveArtifactStrategy({ id: "none", name: "未命名成果物", role: "target", artifactKind: "generic", mimeType: "application/octet-stream", size: 0, extension: "", inputMode: "paste", parseStatus: "ready", structure: [], warnings: [], createdAt: new Date().toISOString() });
  const strategies = targets.map(resolveArtifactStrategy);
  const ids = [...new Set(strategies.map((item) => item.id))];
  if (ids.length === 1) return strategies[0]!;
  const kinds = [...new Set(strategies.map((item) => item.shortLabel))];
  const base = profileForDescriptor({ family: "generic", subtype: "mixed", adapterId: "mixed-artifacts", confidence: 1, preservationMode: "same-package", fidelity: "high", formatExtension: "", editable: true, capabilities: { parse: true, mutate: true, materialize: true, validateStructure: true, execute: false, visual: false }, evolutionDimensions: [], requiredValidations: [], limitations: [] });
  return {
    ...base, id: "mixed-artifacts", kind: "mixed", label: `复合成果物（${kinds.join(" + ")}）`, shortLabel: "复合", userGoalBudget: 50, artifactBudget: 40, systemBudget: 10,
    description: "项目包含多种目标成果物。系统会分别调用原生适配器，并在联合验收阶段检查跨成果一致性。",
    mutationMode: "逐成果物策略 + 跨成果物契约", validationMode: "逐成果物专属验收 + 跨成果物一致性", outputMode: "各自原格式打包交付",
    criteria: criteriaForDescriptor,
    stages: stagesFor("复合成果物", { baseline: "逐类型基线 → 跨成果契约", diagnose: "各自产出问题 + 跨成果不一致 → 根因", evolve: "每类专用构建器 → 复合候选包", verify: "逐类型硬门槛 + 跨成果一致性", deliver: "各自已验收快照 → 原格式打包" }),
  };
}

export function artifactStrategyCriteria(artifacts: SourceArtifact[]) {
  return artifacts.filter((artifact) => artifact.role === "target").flatMap((artifact, index) => resolveArtifactStrategy(artifact).criteria(artifact, index));
}

export function stageSpecForProject(project: Pick<EvolveProject, "sourceArtifacts"> & Partial<Pick<EvolveProject, "semanticEvolution">>, stage: Stage) {
  const strategy = resolveProjectArtifactStrategy(project);
  return strategy.stages.find((item) => item.stages.includes(stage)) ?? strategy.stages[0]!;
}
