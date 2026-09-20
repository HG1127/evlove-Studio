import type { AiOperation } from "./schemas";
import {
  ArtifactAcceptanceAiResultSchema,
  BuildCandidateAiResultSchema,
  CommandAiResultSchema,
  CopilotAiResultSchema,
  ExecuteArtifactAiResultSchema,
  ExecuteArtifactBatchAiResultSchema,
  PopulationEvaluationAiResultSchema,
  MaterializeAiResultSchema,
  RepairArtifactAiResultSchema,
  RubricAiResultSchema,
  IntakeAiResultSchema,
  UnderstandAiResultSchema,
  DiagnosisAiResultSchema,
  EvalSuiteAiResultSchema,
  DistillAiResultSchema,
  EvaluateAiResultSchema,
  GapAdviceAiResultSchema,
  GapClusterAiResultSchema,
  VisualJudgeAiResultSchema,
  NextQueueAiResultSchema,
  PlanAiResultSchema,
  ProblemAnalysisAiResultSchema,
  ReleaseReviewAiResultSchema,
  TargetAiResultSchema,
} from "./schemas";

/** 从粘贴/材料文本里提炼项目名：优先标题行，其次较短的首行，再取第一句完整话。 */
function titleFromText(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  let title = heading ? heading.replace(/^#{1,6}\s*/, "") : "";
  if (!title && lines[0] && lines[0].length <= 32) title = lines[0];
  if (!title) title = text.match(/[^\n。！？!?；;]{4,32}/)?.[0] ?? "";
  return title.replace(/[#*`>|_\-[\]【】()（）:：,，.。!！?？"“”]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24);
}


function demoApplyPatches(original: string, patches: Array<{ target?: string; operation?: string; content?: string }>) {
  let result = original;
  for (const patch of patches) {
    const target = String(patch.target || "").trim();
    const content = String(patch.content || "").trim();
    if (!content) continue;
    if (patch.operation === "update" && target) {
      const heading = new RegExp(`(^|\\n)(#{1,6}\\s+${target.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\n)([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`, "i");
      if (heading.test(result)) { result = result.replace(heading, (_m, prefix, h) => `${prefix}${h}${content}\\n`); continue; }
    }
    if (patch.operation === "remove" && target) {
      result = result.replace(new RegExp(`(^|\\n)#{1,6}\\s+${target.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\n[\\s\\S]*?(?=\\n#{1,6}\\s+|$)`, "i"), "");
      continue;
    }
    result += `\n\n## ${target || "Evolve Enhancement"}\n\n${content}`;
  }
  return result;
}

export function runDemoAi(operation: AiOperation, payload: unknown): unknown {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (operation) {
    case "understand": {
      const project = (p.project ?? {}) as Record<string, unknown>;
      const command = String(project.evolutionCommand || p.command || "");
      const answered = Array.isArray(p.answered) ? (p.answered as Array<{ question?: string }>).map((item) => String(item.question ?? "")) : [];
      return UnderstandAiResultSchema.parse({
        intentRestatement: command ? `演示理解：希望按「${command.slice(0, 80)}」进化当前成果物，重点是把核心要求做成可验证的提升。` : "演示理解：用户尚未给出明确命令，建议先补充进化目标。",
        implicitRequirements: ["成果必须保持完整且可追溯原版", "提升必须能被专属测试题验证"],
        assumptions: ["默认关注主成果质量，而非解析或运行时能力"],
        clarifications: answered.length ? [] : [{ question: "这份成果主要用在什么业务场景？", whyItMatters: "场景决定验收标准的侧重点", defaultAnswer: "先按通用业务成果处理，后续可补充" }],
        acceptanceFocus: ["核心要求被实质满足", "关键能力不退化"],
        confidence: 0.6,
      });
    }
    case "command": {
      const message = String(p.message || "继续按当前目标进化");
      const currentCommand = String(p.currentCommand || "");
      const combined = currentCommand ? `${currentCommand}\n补充要求：${message}` : message;
      const refresh = /目标|必须|不要|保留|禁止|改成|新增附件|依据|按照|只改|不改/.test(message);
      return CommandAiResultSchema.parse({
        answer: refresh ? "已把你的新命令合并进本轮进化要求。由于它会影响目标或边界，建议重新确认 Target Ready，再继续跑 Eval。" : "已记录这条命令；它不会改变当前 Target，可以继续当前阶段。",
        updatedCommand: combined,
        shouldRefreshTarget: refresh,
        protectedItemsAdd: /不要|保留|禁止/.test(message) ? [message.slice(0, 60)] : [],
        editableItemsAdd: [],
        suggestedAction: refresh ? "refresh-target" : "none",
        suggestedActionLabel: refresh ? "刷新 Target Ready" : "继续当前阶段",
      });
    }
    case "intake": {
      const command = String(p.command || "希望系统更稳定、更准确，并能保留当前业务边界");
      const artifacts = Array.isArray(p.artifacts) ? p.artifacts as Array<{ id?: string; name?: string; role?: string; textExcerpt?: string }> : [];
      const primary = artifacts.find((a) => a.role === "target") ?? artifacts[0];
      const pasted = String(p.pastedText || "").trim();
      const placeholderFile = !primary || /^(粘贴内容|用户命令)\.txt$/.test(primary.name ?? "");
      const fileName = placeholderFile ? "" : (primary?.name ?? "").replace(/\.[^.]+$/, "");
      // 粘贴内容优先从正文关键信息取名；文件上传沿用文件名；都没有时退回首段提炼。
      const derived = pasted ? titleFromText(pasted) : fileName || titleFromText(primary?.textExcerpt ?? "");
      const requested = String(p.requestedObjectType || "auto");
      const inferred = requested !== "auto" ? requested : /prompt/i.test(primary?.name || "") ? "prompt" : /workflow|flow/i.test(primary?.name || "") ? "workflow" : /knowledge|kb|memory/i.test(primary?.name || "") ? "knowledge" : "agent";
      const semanticDraft = (p.semanticDraft ?? {}) as { semanticObject?: Record<string, unknown>; workflowStages?: unknown[]; warnings?: string[]; acceptanceRubric?: unknown[] };
      return IntakeAiResultSchema.parse({
        projectName: derived ? (pasted ? derived : `${derived} · Evolve`) : "新对象 · Evolve",
        detectedObjectType: inferred,
        currentStateSummary: primary ? `已接收 ${artifacts.length} 个输入，其中“${primary.name}”作为主要进化对象。Demo AI 已读取可解析文本与附件元数据。` : "已接收用户粘贴的进化内容。",
        evolutionIntent: command,
        goal: `按照用户命令“${command.slice(0, 90)}”持续提升该对象的任务质量、稳定性与可验证性，同时保护原有关键能力。`,
        metrics: [
          { key: "success", label: "任务成功率", target: 90, unit: "%", direction: "higher", why: "确认主要任务真正完成" },
          { key: "quality", label: "目标质量达成率", target: 90, unit: "%", direction: "higher", why: "衡量用户命令要求是否满足" },
          { key: "robustness", label: "稳定通过率", target: 85, unit: "%", direction: "higher", why: "避免只对单一案例有效" },
          { key: "cost", label: "平均成本", target: 0.5, unit: "¥", direction: "lower", why: "限制进化带来的额外成本" },
        ],
        protectedItems: ["用户未授权修改的业务边界", "安全与权限规则", "原始输入文件必须保留可追溯版本"],
        editableItems: inferred === "prompt" ? ["Prompt 内容", "Few-shot 示例", "输出约束"] : ["Prompt", "Workflow", "Tool 调用策略"],
        acceptanceCriteria: ["用户命令中的核心要求可被测试用例验证", "新版本不得出现关键能力退化", "改动必须能追溯到具体输入与 Candidate Patch"],
        acceptanceRubric: Array.isArray(semanticDraft.acceptanceRubric) && semanticDraft.acceptanceRubric.length >= 3 ? semanticDraft.acceptanceRubric : [
          { id: "REQ-COMMAND", title: "核心进化要求", requirement: `最终成果必须实质满足用户命令：${command}`, source: "user-command", weight: 35, hardGate: true, judgeType: "llm", minScore: 90, evidenceExpected: ["最终成果中可定位到与命令直接对应的实现或内容"], protectedConstraint: false, artifactIds: artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||"")), category:"outcome" },
          { id: "REQ-QUALITY", title: "任务质量提升", requirement: "最终成果必须相对当前版本在主要任务质量上产生可验证提升，而不是仅增加说明文字。", source: "source-understanding", weight: 20, hardGate: false, judgeType: "pairwise", minScore: 85, evidenceExpected: ["原版与进化版的差异及其对任务结果的改善"], protectedConstraint: false, artifactIds: artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||"")), category:"outcome" },
          { id: "PROTECT-BOUNDARY", title: "业务边界保护", requirement: "不得破坏用户未授权修改的业务边界、安全规则、权限与既有关键能力。", source: "protected-item", weight: 15, hardGate: true, judgeType: "pairwise", minScore: 95, evidenceExpected: ["与原始版本对比无关键能力退化"], protectedConstraint: true, artifactIds: artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||"")), category:"protected" },
          { id: "SYS-INTEGRITY", title: "成果完整性", requirement: "最终成果必须完整、无截断、无占位符、无未处理 TODO，并保留未授权删除的内容。", source: "system-integrity", weight: 15, hardGate: true, judgeType: "integrity", minScore: 95, evidenceExpected: ["完整成果内容与完整性检查"], protectedConstraint: true, artifactIds: artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||"")), category:"integrity" },
          { id: "SYS-PAIRWISE", title: "相对原版真实改进", requirement: "最终成果必须相对原始版本显著更符合本项目进化目标。", source: "system-integrity", weight: 15, hardGate: true, judgeType: "pairwise", minScore: 85, evidenceExpected: ["原版 vs 最终版对比"], protectedConstraint: false, artifactIds: artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||"")), category:"outcome" },
        ],
        semanticObject: semanticDraft.semanticObject ?? { typeId:"generic-evolution-object",label:"业务成果",domain:"通用",description:"Demo 模式使用本地语义编译器",confidence:0.6,audience:[],primaryOutcome:command,componentArtifactIds:artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||"")),crossArtifactRequirements:[],reasoning:["使用本地语义草稿"] },
        semanticWorkflowStages: Array.isArray(semanticDraft.workflowStages) && semanticDraft.workflowStages.length===6 ? semanticDraft.workflowStages : [
          {id:"define",label:"理解目标",flow:"成果 + 用户要求 → 进化契约",input:"全部输入",action:"理解业务对象与目标",output:"进化契约",done:"目标和边界清楚",applicableArtifactIds:artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||""))},
          {id:"baseline",label:"建立模型",flow:"成果结构 → 关系模型",input:"原始成果",action:"展开结构与关系",output:"Artifact Graph",done:"组成和关系清楚",applicableArtifactIds:artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||""))},
          {id:"diagnose",label:"诊断问题",flow:"关系图 → 问题与根因",input:"当前表现",action:"分离问题与原因",output:"问题地图 + 根因",done:"根因可证伪",applicableArtifactIds:artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||""))},
          {id:"evolve",label:"自适应进化",flow:"根因 → 专用 Builder → 候选成果",input:"原生结构",action:"按类型和业务角色分别进化",output:"真实候选成果",done:"候选可直接验收",applicableArtifactIds:artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||""))},
          {id:"verify",label:"动态验收",flow:"候选 → 用户+业务+格式标准",input:"候选成果",action:"联合验收",output:"验收矩阵",done:"Hard Gate 全通过",applicableArtifactIds:artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||""))},
          {id:"deliver",label:"原格式交付",flow:"已验收快照 → 同格式输出",input:"已验收成果",action:"保持格式物化",output:"交付包",done:"下载即验收版本",applicableArtifactIds:artifacts.filter((a)=>a.role==="target").map((a)=>String(a.id||""))},
        ],
        semanticWarnings: semanticDraft.warnings ?? [],
        risks: ["附件上下文可能包含隐含约束，需要在 Gate 1 确认", "只优化少量示例可能过拟合"],
        artifactSummaries: artifacts.map((a) => ({ artifactId: String(a.id || a.name || "artifact"), summary: a.textExcerpt ? `${a.name}: ${a.textExcerpt.slice(0, 180)}` : `${a.name}: 已接收附件`, detectedRole: a.role || "target" })),
        followUpQuestions: artifacts.length === 0 ? ["请补充需要进化的内容或上传附件。"] : [],
      });
    }
    case "target":
      return TargetAiResultSchema.parse({
        goal: "提升任务输出的证据完整度和风险分析质量，同时保护现有核心结构、数据源与成本边界。",
        metrics: [
          { key: "success", label: "任务成功率", target: 90, unit: "%", direction: "higher", why: "保证整体任务质量" },
          { key: "evidence", label: "证据完整率", target: 90, unit: "%", direction: "higher", why: "确保关键结论可验证" },
          { key: "risk", label: "风险覆盖率", target: 85, unit: "%", direction: "higher", why: "降低单边判断" },
          { key: "cost", label: "平均成本", target: 0.5, unit: "¥", direction: "lower", why: "避免为了质量无限增加成本" },
        ],
        protectedItems: ["输出语言", "核心数据源", "权限与生产环境配置"],
        editableItems: ["Prompt", "Workflow", "Tool 调用策略"],
        acceptanceCriteria: ["关键结论有证据", "包含风险与反证", "关键指标不退化", "成本不超过边界"],
        risks: ["过度增加检查步骤可能提高延迟", "只针对已知评测题优化可能导致过拟合"],
      });
    case "eval-suite": {
      const project = (p.project ?? {}) as { objectType?: string; goal?: string; problemStatement?: string };
      const objectLabel = project.objectType || "AI capability";
      return EvalSuiteAiResultSchema.parse({
        validationCases: [
          { id: "val-normal", title: "核心正常场景", input: `执行一个典型 ${objectLabel} 核心任务，并完整满足业务目标。`, expected: ["完成主要任务", "结果可核验", "符合目标约束"], tags: ["normal", "core"], hidden: false },
          { id: "val-evidence", title: "证据与完整性", input: "处理一个需要多个事实依据的任务；不要遗漏关键依据与限制条件。", expected: ["关键结论有依据", "不确定项明确标注", "输出完整"], tags: ["quality", "evidence"], hidden: false },
          { id: "val-risk", title: "风险与反例", input: "处理一个存在明显反例或失败条件的任务，并说明风险。", expected: ["包含风险", "包含反例或失败条件", "不做无依据绝对判断"], tags: ["risk", "robustness"], hidden: false },
          { id: "val-efficiency", title: "效率边界", input: "在信息足够的情况下完成任务，避免重复步骤和不必要调用。", expected: ["结果正确", "无明显重复", "满足成本与延迟边界"], tags: ["cost", "latency"], hidden: false },
        ],
        hiddenCases: [
          { id: "holdout-missing", title: "信息缺失", input: "输入信息不完整，请在不能确认时明确说明缺失，不要自行补全事实。", expected: ["识别缺失信息", "不编造", "给出可执行下一步"], tags: ["hidden", "missing-data"], hidden: true },
          { id: "holdout-conflict", title: "信息冲突", input: "两个可信来源给出互相冲突的信息，请处理冲突并说明依据。", expected: ["识别冲突", "给出证据权衡", "保留不确定性"], tags: ["hidden", "conflict"], hidden: true },
          { id: "holdout-failure", title: "依赖失败", input: "一个必要工具或外部依赖不可用，请安全降级并说明影响。", expected: ["识别依赖失败", "执行 fallback", "不伪造工具结果"], tags: ["hidden", "tool-failure"], hidden: true },
        ],
        summary: `已根据 ${objectLabel} 的目标生成核心、质量、风险、效率以及隐藏边界场景。`,
      });
    }
    case "problem-analysis":
      return ProblemAnalysisAiResultSchema.parse({
        problems: [
          { id: "p1", title: "重要结论缺少证据", impact: 18, severity: "high", status: "recommended", summary: "多个失败任务在最终输出阶段丢失已经检索到的来源。", rootCause: "Synthesis 前缺少 Claim → Evidence 检查。", evidence: ["69/82 个失败 Trace 中 Research 已找到来源", "Final Report 中未绑定 citation"], confidence: 0.88, affectedComponent: "Synthesis Workflow" },
          { id: "p2", title: "风险分析遗漏", impact: 11, severity: "high", status: "planned", summary: "复杂场景缺少反证和下行情景。", rootCause: "Risk checklist 未进入最终生成约束。", evidence: ["高波动样本中风险字段缺失率更高"], confidence: 0.76, affectedComponent: "Risk Analysis" },
          { id: "p3", title: "输出冗余", impact: 8, severity: "medium", status: "observing", summary: "背景信息重复，导致篇幅和成本增加。", rootCause: "Synthesis 缺少去重与长度预算。", evidence: ["重复段落集中在背景模块"], confidence: 0.71, affectedComponent: "Synthesis Prompt" },
        ],
        recommendedProblemId: "p1",
        summary: "证据缺失影响最大、根因证据最清楚，适合作为本轮优先问题。",
      });
    case "diagnose":
      return DiagnosisAiResultSchema.parse({
        problemId: String(p.problemId || "p1"),
        rootCause: "Research 阶段已经取得来源，但 Synthesis 前没有逐 Claim 检查 Evidence Coverage，因此最终报告在组合内容时丢失引用。",
        summary: "问题主要发生在最终输出流程，而不是搜索能力。",
        affectedComponent: "Synthesis Workflow / Prompt",
        confidence: 0.9,
        evidence: ["69/82 个失败样本已经检索到相关来源", "最终输出 Trace 不存在 Evidence Gate", "单纯增加搜索次数在历史实验中无稳定提升"],
        counterEvidence: ["少量样本确实存在来源本身不足，需要保留 Search fallback"],
        falsifier: "如果加入 Evidence Gate 后 Hidden Holdout 的证据覆盖提升低于 3pt，则需要重新检查 Citation Tool 或 Synthesis Prompt。",
        suggestedScopes: ["prompt", "workflow", "tool"],
        trace: [
          { id: "t1", stage: "Research", summary: "已获取 6 个有效来源", status: "pass", detail: "检索结果包含目标事实" },
          { id: "t2", stage: "Analysis", summary: "关键结论形成", status: "pass", detail: "结论与来源一致" },
          { id: "t3", stage: "Evidence Gate", summary: "检查节点缺失", status: "fail", detail: "没有 Claim → Evidence coverage 约束" },
          { id: "t4", stage: "Final Report", summary: "部分引用丢失", status: "warning", detail: "最终输出只保留 3/6 条证据" },
        ],
      });
    case "plan": {
      // demo patch 锚定原文真实小节：update 型 patch 的 target 换成原文已有标题，
      // content = 该节原文正文 + 本轮改进，保证进化成果物与原文同骨架、提升可见；原文无标题时保持原行为。
      const planProject = (p.project ?? {}) as { sourceArtifacts?: Array<{ role?: string; textContent?: string }> };
      const sourceText = planProject.sourceArtifacts?.find((item) => item.role === "target")?.textContent ?? planProject.sourceArtifacts?.[0]?.textContent ?? "";
      const sectionBodies = new Map<string, string>();
      {
        let current: string | null = null;
        let body: string[] = [];
        for (const line of sourceText.split("\n")) {
          if (/^#{1,6}\s+/.test(line)) {
            if (current) sectionBodies.set(current, body.join("\n"));
            current = line.replace(/^#{1,6}\s+/, "").trim();
            body = [];
          } else if (current) body.push(line);
        }
        if (current) sectionBodies.set(current, body.join("\n"));
      }
      const headings = [...sectionBodies.keys()];
      let updateCursor = 0;
      // 演示候选同样带完整设计论证链：源证据引用 / 指令对应 / 机制 / 验收标准 / 保护项 / 证伪条件，
      // 保证演示态与真实 AI 输出在同一张方案卡上呈现同一种「可审查的推理」。
      const DEMO_SOURCE_QUOTE = "你是一名投资研究 Agent。完成公司研究并输出业务、增长、竞争与风险分析……";
      const DEMO_REFERENCE_QUOTE = "优秀样例：每个关键结论后附来源，并单独列出反证条件……";
      const base = [
          {
            id: "A", name: "Candidate A", title: "Prompt Repair", change: "只修改 Synthesis Prompt", hypothesis: "显式要求逐条绑定证据即可改善遗漏。",
            patches: [{ id: "A1", component: "prompt", operation: "update", target: "synthesis.system", content: "在生成最终报告前先列出关键 Claims，并为每个 Claim 绑定至少一个 Evidence；没有 Evidence 的 Claim 必须删除或标注不确定。", rationale: "最小化改动验证 Prompt 是否足够" }],
            riskLevel: "low", expectedImpact: "证据覆盖中等提升，成本基本不变", risks: ["仅靠 Prompt 约束可能不稳定"], accuracy: 0, evidence: 0, riskCoverage: 0, costDelta: 0, speedDelta: 0, safety: "REVIEW", recommended: false, status: "draft", notes: [],
            designRationale: { sourceEvidence: [DEMO_SOURCE_QUOTE], commandAlignment: "对应指令原句「重要结论必须有证据」", mechanism: "在 Synthesis 节加入逐 Claim 绑定指令 → 模型输出前被迫为每条结论核对证据 → 证据完整率上升", coveredCriteria: ["关键结论有证据"], protectedCompliance: "只新增绑定要求，不改动报告整体结构与中文输出", falsifier: "若实验后证据覆盖率未提升，说明软 Prompt 约束对该对象无效" },
          },
          {
            id: "B", name: "Candidate B", title: "Evidence Gate", change: "新增 Evidence Check Workflow 节点", hypothesis: "结构化检查节点能稳定阻断无证据结论。",
            patches: [{ id: "B1", component: "workflow", operation: "add", target: "before:synthesis", content: "EvidenceCheckNode: build claim list → bind evidence → coverage threshold 90% → fallback to research", rationale: "把质量检查从软提示升级为流程 Gate" }],
            riskLevel: "medium", expectedImpact: "证据覆盖高提升，延迟略增加", risks: ["增加一次检查可能提高延迟"], accuracy: 0, evidence: 0, riskCoverage: 0, costDelta: 0, speedDelta: 0, safety: "REVIEW", recommended: false, status: "draft", notes: [],
            designRationale: { sourceEvidence: [DEMO_SOURCE_QUOTE], commandAlignment: "把「重要结论必须有证据」升级为流程级硬约束", mechanism: "在 Synthesis 前插入 EvidenceCheckNode → 无证据结论被阻断并回退研究 → 证据遗漏从结构上消失", coveredCriteria: ["关键结论有证据"], protectedCompliance: "新增节点不修改既有小节内容，交付格式不变", falsifier: "若加 Gate 后遗漏仍出现或延迟明显超可接受范围，结构 Gate 假设不成立" },
          },
          {
            id: "C", name: "Candidate C", title: "Prompt + Gate", change: "Prompt 与 Evidence Gate 组合", hypothesis: "软约束 + 结构 Gate 同时存在时最稳定。",
            patches: [
              { id: "C1", component: "prompt", operation: "update", target: "synthesis.system", content: "输出前建立 Claim List；所有事实型结论都必须引用 Evidence ID。", rationale: "让生成阶段主动维护证据关系" },
              { id: "C2", component: "workflow", operation: "add", target: "before:synthesis", content: "EvidenceCheckNode with 90% coverage threshold and research fallback", rationale: "在流程层提供确定性检查" },
            ],
            riskLevel: "medium", expectedImpact: "证据覆盖最高，且可通过减少返工控制成本", risks: ["需要避免重复检查"], accuracy: 0, evidence: 0, riskCoverage: 0, costDelta: 0, speedDelta: 0, safety: "REVIEW", recommended: true, status: "draft", notes: [],
            designRationale: { sourceEvidence: [DEMO_SOURCE_QUOTE, DEMO_REFERENCE_QUOTE], commandAlignment: "同时落实「重要结论必须有证据」与「不要明显增加成本」（靠减少返工）", mechanism: "软约束在生成阶段维护证据关系 + 结构 Gate 在流程阶段确定性兜底，两者叠加最稳定", coveredCriteria: ["关键结论有证据"], protectedCompliance: "两处改动只作用在生成与检查环节，不动数据源与报告骨架", falsifier: "若组合版得分不高于单改动版，说明叠加无增益，应退回单一机制" },
          },
          {
            id: "D", name: "Candidate D", title: "Citation Validator", change: "增加 Citation Validator Tool", hypothesis: "独立验证工具可以识别引用和 Claim 的不一致。",
            patches: [{ id: "D1", component: "tool", operation: "add", target: "citation-validator", content: "Validate each factual claim against cited source and return unresolved claim ids", rationale: "用独立工具检查引用质量" }],
            riskLevel: "medium", expectedImpact: "证据质量提升但成本和延迟可能上升", risks: ["新增 Tool 调用成本", "Tool timeout 需要 fallback"], accuracy: 0, evidence: 0, riskCoverage: 0, costDelta: 0, speedDelta: 0, safety: "REVIEW", recommended: false, status: "draft", notes: [],
            designRationale: { sourceEvidence: [DEMO_REFERENCE_QUOTE], commandAlignment: "保障「重要结论必须有证据」的可靠性而不只是存在性", mechanism: "独立 Validator 逐条比对引用与 Claim → 不一致以 unresolved ids 暴露 → 证据质量可量化", coveredCriteria: ["关键结论有证据"], protectedCompliance: "只读校验工具，不写回报告内容", falsifier: "若 Validator 误报率高导致正确结论被大量删除，独立校验路线不成立" },
          },
          {
            id: "E", name: "Candidate E", title: "Verified Skill Reuse", change: "复用历史 Claim-Evidence Skill 并收紧触发条件", hypothesis: "经验证的 Skill 可以降低重复搜索成本，同时保留稳定提升。",
            patches: [{ id: "E1", component: "memory", operation: "add", target: "skill-registry:claim-evidence", content: "Reuse verified claim-evidence gate only for factual claims; skip pure opinion sections", rationale: "利用 Archive 中已经验证的经验做 exploit" }],
            riskLevel: "low", expectedImpact: "提高样本效率，减少重复探索", risks: ["需要验证 Skill 对当前对象是否可迁移"], accuracy: 0, evidence: 0, riskCoverage: 0, costDelta: 0, speedDelta: 0, safety: "REVIEW", recommended: false, status: "draft", notes: [],
            designRationale: { sourceEvidence: [DEMO_REFERENCE_QUOTE], commandAlignment: "对应「同时不要明显增加成本」", mechanism: "复用已验证的 claim-evidence Skill 跳过重复搜索 → 成本与延迟下降且保留证据提升", coveredCriteria: ["关键结论有证据"], protectedCompliance: "Skill 仅注册为可选记忆项，不改变主流程", falsifier: "若 Skill 迁移失败导致证据覆盖回退，复用假设不成立" },
          },
          {
            id: "F", name: "Candidate F", title: "Novelty Branch", change: "将 Evidence Gate 前移到 Analysis 并增加失败回退策略", hypothesis: "改变检查时机可能成为新的 stepping stone，避开局部最优。",
            patches: [{ id: "F1", component: "workflow", operation: "add", target: "after:analysis", content: "Pre-synthesis evidence readiness check; unresolved claims return to research before final synthesis", rationale: "开放式探索不同的流程拓扑" }],
            riskLevel: "medium", expectedImpact: "可能减少后期返工并形成新的高质量 niche", risks: ["流程前移可能增加部分任务的搜索次数"], accuracy: 0, evidence: 0, riskCoverage: 0, costDelta: 0, speedDelta: 0, safety: "REVIEW", recommended: false, status: "draft", notes: [],
            designRationale: { sourceEvidence: [DEMO_SOURCE_QUOTE], commandAlignment: "为「提升风险分析完整度且不明显增加成本」探索新路径", mechanism: "证据检查前移到 Analysis → 缺口早发现、减少 Synthesis 后返工 → 可能形成新的高质量 niche", coveredCriteria: ["包含反证与下行情景"], protectedCompliance: "只调整检查时机，不删除任何既有节点", falsifier: "若搜索次数与延迟同时上升而覆盖无改善，前移拓扑不成立" },
          },
      ];
      for (const candidate of base) for (const patch of candidate.patches) {
        if (patch.operation !== "update" || !headings.length) continue;
        const heading = headings[updateCursor % headings.length]!;
        updateCursor += 1;
        patch.target = heading;
        patch.content = `${(sectionBodies.get(heading) ?? "").trim()}\n\n${patch.content}`;
      }
      return PlanAiResultSchema.parse({
        candidates: base,
        recommendedCandidateIds: ["A", "B", "C", "D", "E", "F"],
        summary: "同时保留 exploit、结构变异、工具变异、Skill 复用和 novelty branch，避免单线 Prompt hill-climbing。",
        experimentDesign: ["所有候选使用同一 Validation Suite", "记录准确率、证据覆盖、风险覆盖、成本和延迟", "关键安全回归直接淘汰", "Winner 必须继续通过 Hidden Holdout"],
      });
    }
    case "rubric": {
      const project = (p.project ?? {}) as { acceptanceCriteria?: string[]; protectedItems?: string[]; metrics?: Array<{ key?: string; label?: string; target?: number }> };
      const raw = [...(project.acceptanceCriteria || [])];
      const protectedItems = project.protectedItems || [];
      const criteria = [
        ...raw.map((item, index) => ({ id: `REQ-${index + 1}`, title: `用户要求 ${index + 1}`, requirement: item, source: "source-understanding" as const, weight: Math.max(8, Math.round(60 / Math.max(1, raw.length))), hardGate: false, judgeType: "llm" as const, minScore: 85, evidenceExpected: ["最终成果中能定位到对应实现/内容"], protectedConstraint: false })),
        ...protectedItems.map((item, index) => ({ id: `PROTECT-${index + 1}`, title: `保护项 ${index + 1}`, requirement: `不得破坏：${item}`, source: "protected-item" as const, weight: 8, hardGate: true, judgeType: "pairwise" as const, minScore: 95, evidenceExpected: ["与原始成果对比无退化"], protectedConstraint: true })),
        { id: "INTEGRITY", title: "成果完整性", requirement: "最终成果必须完整、无截断、无占位符、无未处理 TODO，且不能因进化丢失未授权内容。", source: "system-integrity" as const, weight: 15, hardGate: true, judgeType: "integrity" as const, minScore: 95, evidenceExpected: ["完整内容", "无截断/placeholder"], protectedConstraint: true },
        { id: "PAIRWISE", title: "相对原版真实改进", requirement: "最终成果必须相对原始版本显著更符合用户进化目标，而不是只增加说明文字。", source: "system-integrity" as const, weight: 15, hardGate: true, judgeType: "pairwise" as const, minScore: 85, evidenceExpected: ["原版 vs 新版对比"], protectedConstraint: false },
      ];
      return RubricAiResultSchema.parse({ criteria: criteria.slice(0, 20), summary: "已将用户要求、保护项和成果完整性转换为 Artifact Acceptance Rubric。" });
    }
    case "build-candidate": {
      const candidate = (p.candidate ?? {}) as { id?: string; title?: string; patches?: Array<{ artifactId?: string; target?: string; operation?: string; content?: string }> };
      const artifacts = Array.isArray(p.targetArtifacts) ? p.targetArtifacts as Array<{ id?: string; name?: string; mimeType?: string; textContent?: string; textExcerpt?: string }> : [];
      return BuildCandidateAiResultSchema.parse({
        artifacts: artifacts.map((artifact, index) => ({
          sourceArtifactId: artifact.id || `source-${index + 1}`,
          name: artifact.name || `candidate-${index + 1}.md`,
          mimeType: artifact.mimeType || "text/markdown",
          content: demoApplyPatches(artifact.textContent || artifact.textExcerpt || "", (candidate.patches || []).filter((patch) => !patch.artifactId || patch.artifactId === artifact.id)),
          contentHash: `demo-${candidate.id || "candidate"}-${index}`,
          buildMode: "deterministic",
          notes: ["Demo Candidate Builder：已生成完整 Candidate Artifact Snapshot；Live AI 模式会做全文融合重写。"],
        })),
        summary: `已为 ${candidate.title || candidate.id || "Candidate"} 构造完整候选成果。`,
      });
    }
    case "artifact-acceptance": {
      const rubric = Array.isArray(p.rubric) ? p.rubric as Array<{ id?: string; minScore?: number; hardGate?: boolean; requirement?: string }> : [];
      const artifacts = Array.isArray(p.artifacts) ? p.artifacts as Array<{ content?: string }> : [];
      const combined = artifacts.map((a) => a.content || "").join("\n");
      const integrity = combined.length > 400 && !/\[\.\.\.truncated|TODO\b|PLACEHOLDER/i.test(combined) ? 96 : 72;
      const results = rubric.map((criterion, index) => {
        const score = criterion.id === "INTEGRITY" ? integrity : 90 - Math.min(index, 3);
        return { criterionId: criterion.id || `C${index + 1}`, score, pass: score >= (criterion.minScore ?? 80), evidence: [combined.slice(0, 120) || "已生成成果"], gaps: score >= (criterion.minScore ?? 80) ? [] : [String(criterion.requirement || "未完全满足")], note: "Demo Acceptance Judge" };
      });
      const hardGatePass = results.every((r, i) => !(rubric[i]?.hardGate) || r.pass);
      const overall = results.length ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length) : integrity;
      return ArtifactAcceptanceAiResultSchema.parse({ overallScore: overall, coverageScore: overall, integrityScore: integrity, pairwiseScore: Math.min(95, overall + 1), hardGatePass, results, summary: hardGatePass ? "成果通过 Demo Artifact Acceptance。" : "成果仍存在 Hard Gate 缺口，需要 Repair。" });
    }
    case "repair-artifact": {
      const artifacts = Array.isArray(p.artifacts) ? p.artifacts as Array<{ sourceArtifactId?: string; name?: string; mimeType?: string; content?: string }> : [];
      const failed = Array.isArray(p.failedCriteria) ? p.failedCriteria as Array<{ criterionId?: string; requirement?: string; gaps?: string[] }> : [];
      const repairText = failed.map((item) => `- ${item.criterionId}: ${item.requirement || ""} ${(item.gaps || []).join("；")}`).join("\n");
      return RepairArtifactAiResultSchema.parse({
        artifacts: artifacts.map((artifact) => ({ sourceArtifactId: artifact.sourceArtifactId || "source", name: artifact.name || "artifact.md", mimeType: artifact.mimeType || "text/markdown", content: `${artifact.content || ""}\n\n## Acceptance Repair\n\n${repairText}`, notes: ["Demo Repair Agent 根据失败验收项补强成果。"] })),
        repairedCriteria: failed.map((item) => String(item.criterionId || "criterion")), summary: "已按失败验收项执行 Repair，需重新跑 Hidden Validation 与 Artifact Acceptance。",
      });
    }
    case "execute-artifact": {
      const testCase = (p.testCase ?? {}) as { id?: string; title?: string; input?: string };
      const variant = (p.variant ?? {}) as { name?: string; change?: string; patches?: Array<{ content?: string }> };
      const hasVariant = Boolean(variant.name);
      const patchText = (variant.patches || []).map((x) => x.content).join(" ");
      return ExecuteArtifactAiResultSchema.parse({
        output: [
          `任务：${testCase.title || "测试任务"}`,
          `输入：${testCase.input || ""}`,
          hasVariant ? `Candidate：${variant.name}；改动：${variant.change}` : "Baseline：按当前上传对象执行",
          hasVariant && /evidence|证据|claim/i.test(patchText) ? "Evidence Gate: all claims mapped to evidence; includes falsifiers." : "Evidence status: some claims miss evidence; risk section incomplete.",
          "结果：已基于上传对象与本轮测试要求生成输出。",
        ].join("\n"),
        trace: [
          { id: `${testCase.id || "test"}-source`, stage: "Source", summary: "读取进化对象", status: "pass", detail: "使用上传附件 / 粘贴内容作为运行上下文" },
          { id: `${testCase.id || "test"}-patch`, stage: "Candidate Patch", summary: hasVariant ? "应用候选修改" : "使用当前 Champion", status: "pass", detail: hasVariant ? variant.change || "Candidate patches" : "Baseline" },
          { id: `${testCase.id || "test"}-output`, stage: "Output", summary: "完成测试任务", status: "pass", detail: "Demo artifact runtime" },
        ],
      });
    }
    case "execute-artifact-batch": {
      const testCases = Array.isArray(p.testCases) ? p.testCases as Array<{ id?: string; title?: string; input?: string }> : [];
      const variant = (p.variant ?? {}) as { name?: string; change?: string; patches?: Array<{ content?: string }> };
      const patchText = (variant.patches || []).map((x) => x.content).join(" ");
      return ExecuteArtifactBatchAiResultSchema.parse({
        results: testCases.map((testCase) => ({
          testCaseId: String(testCase.id || "case"),
          output: [`任务：${testCase.title || "测试任务"}`, `输入：${testCase.input || ""}`, variant.name ? `Candidate：${variant.name}` : "Baseline", /evidence|证据|claim/i.test(patchText) ? "Evidence Gate: all claims mapped to evidence." : "Evidence status: some claims miss evidence.", "结果：批量 Artifact Runtime 已执行本题。"].join("\n"),
          trace: [{ id: `${testCase.id || "case"}-batch`, stage: "Batch Artifact Runtime", summary: "复用同一 Candidate 上下文执行测试", status: "pass", detail: "Demo batch executor" }],
        })),
      });
    }
    case "evaluate-population": {
      const candidates = Array.isArray(p.candidates) ? p.candidates as Array<{ candidateId?: string; runs?: Array<{ error?: string; output?: string }> }> : [];
      return PopulationEvaluationAiResultSchema.parse({
        candidates: candidates.map((candidate, index) => {
          const failed = (candidate.runs || []).filter((run) => run.error).length;
          const text = (candidate.runs || []).map((run) => run.output || "").join(" ");
          const evidence = /all claims mapped|Evidence Gate|citation validator/i.test(text);
          const score = Math.max(30, Math.min(96, 88 + (evidence ? 5 : 0) - failed * 18 - index));
          return { candidateId: String(candidate.candidateId || `C${index + 1}`), score, hardGatePass: failed === 0, safety: failed ? "REVIEW" : "PASS", strengths: evidence ? ["关键证据约束已出现"] : ["完成预筛任务"], gaps: failed ? [`${failed} 个预筛任务失败`] : [] };
        }),
        summary: "Demo Population Judge 完成 Successive Halving 预筛。",
      });
    }
    case "materialize": {
      const artifacts = Array.isArray(p.targetArtifacts) ? p.targetArtifacts as Array<{ id?: string; name?: string; mimeType?: string; textContent?: string; textExcerpt?: string }> : [];
      const champion = (p.champion ?? {}) as { versionLabel?: string; patches?: Array<{ target?: string; content?: string; rationale?: string }> };
      const patchBlock = (champion.patches || []).map((patch, index) => `${index + 1}. ${patch.target || "target"}: ${patch.content || ""}`).join("\n");
      return MaterializeAiResultSchema.parse({
        artifacts: artifacts.map((artifact, index) => ({
          sourceArtifactId: artifact.id || `source-${index + 1}`,
          name: `evolved-${artifact.name || `artifact-${index + 1}.md`}`,
          mimeType: artifact.mimeType || "text/markdown",
          content: `${artifact.textContent || artifact.textExcerpt || `Source: ${artifact.name || "artifact"}`}\n\n---\nEVOLVED BY ${champion.versionLabel || "SEARCH_CHAMPION"}\n${patchBlock}`,
          notes: "Demo Materializer：保留源内容并附加 Champion Patch Set；连接 Live AI 后会按 Patch 真正重写文本型成果。",
        })),
        summary: `已根据 ${champion.versionLabel || "Search Champion"} 物化 ${artifacts.length} 个目标成果。`,
      });
    }
    case "release-review":
      return ReleaseReviewAiResultSchema.parse({
        recommendation: "release",
        summary: "候选在公开验证和隐藏测试上均优于基线，且未发现关键安全退化，可以进入 Shadow。",
        reasons: ["证据覆盖显著提升", "准确率同步提升", "成本未恶化", "安全检查 PASS"],
        risks: ["真实生产流量可能包含更长上下文", "Tool 故障率需要在 Canary 持续观察"],
        requiredChecks: ["Shadow 对比至少覆盖一轮真实流量", "Canary 每级检查业务 KPI", "保留一键 Rollback"],
      });
    case "distill": {
      const release = (p.release ?? {}) as { status?: string };
      const rolledBack = release.status === "rolled-back";
      return DistillAiResultSchema.parse({
        title: rolledBack ? "当前 Candidate 在线上流量中出现回归" : "Claim → Evidence Gate",
        summary: rolledBack ? "该方案离线测试通过，但生产 Canary 出现关键回归。保留失败条件和触发场景，禁止直接复用。" : "事实型任务在最终生成前先构建 Claim List，再逐条绑定证据；覆盖不足时返回 Research 补证据。",
        reusable: !rolledBack,
        effect: rolledBack ? "线上验证未通过，已回滚到上一 Champion" : "证据覆盖显著提升，且在 Hidden Holdout 与生产 Canary 均保持稳定",
        limit: rolledBack ? "只有重新定位回归原因并通过新一轮 Holdout/Canary 后才能再次尝试。" : "纯观点型任务或没有外部证据要求的创意任务不应强制启用。",
        trigger: rolledBack ? ["生产流量回归", "Canary 指标恶化"] : ["事实型研究", "需要引用来源", "多来源综合"],
        method: rolledBack ? ["保存失败 Trace", "记录触发条件", "下一轮重新诊断"] : ["Build Claim List", "Bind Evidence per Claim", "Coverage < 90% → Research fallback", "Only then synthesize"],
        validatedOn: rolledBack ? ["Offline Validation", "Production Canary Failed"] : ["Validation Suite", "Hidden Holdout", "Production Canary"],
        status: rolledBack ? "anti-pattern" : "verified-skill",
      });
    }
    case "next-queue":
      return NextQueueAiResultSchema.parse({
        items: [
          { id: "q1", title: "搜索资料不完整", reason: "仍影响约 12% 的任务，且根因集中在 Search Routing。", priority: "P0", source: "Remaining Failures", suggestedMetrics: ["source coverage", "search success", "cost"] },
          { id: "q2", title: "信息冲突处理", reason: "新生产 Trace 中出现多源冲突无法稳定裁决。", priority: "P1", source: "New Production Trace", suggestedMetrics: ["conflict resolution accuracy", "evidence quality"] },
          { id: "q3", title: "Tool timeout fallback", reason: "少量线上请求受工具超时影响。", priority: "P1", source: "Production Errors", suggestedMetrics: ["recovery rate", "latency"] },
        ],
        recommendedId: "q1",
        summary: "下一轮建议先处理搜索资料完整性，因为频率高、业务影响明确，并有可控的 Workflow/Tool 修复空间。",
      });
    case "copilot": {
      const message = String(p.message || "");
      const stage = String(p.stage || "target");
      const actionByStage: Record<string, { action: string; label: string }> = {
        target: { action: "confirm-target", label: "确认 Target Ready" },
        baseline: { action: "generate-eval-suite", label: "生成 / 检查 Eval Suite" },
        problem: { action: "analyze-problems", label: "AI 分析问题" },
        diagnosis: { action: "generate-plan", label: "生成进化方案" },
        plan: { action: "approve-experiment", label: "确认 Experiment Ready" },
        experiment: { action: "run-validation", label: "运行 Hidden Validation" },
        validation: { action: "approve-release", label: "确认 Release Ready" },
        release: { action: "advance-canary", label: "推进下一发布阶段" },
        learning: { action: "distill-learning", label: "提炼本轮经验" },
      };
      const suggested = /成果|输出|下载|交付/.test(message)
        ? { action: "materialize-outputs", label: "生成 Best-Ever 成果包" }
        : /自动.*进化|连续.*轮|多轮|campaign/i.test(message)
          ? { action: "run-campaign", label: "启动多轮 Evolution Campaign" }
          : /下一轮|跑一轮/.test(message)
            ? { action: "run-campaign-round", label: "运行下一轮 Evolution Search" }
            : actionByStage[stage] ?? { action: "none", label: "查看当前阶段证据" };
      return CopilotAiResultSchema.parse({
        answer: message ? `我已结合当前项目在“${stage}”阶段的证据分析：“${message}”。建议先确认当前 Gate 的证据，再执行“${suggested.label}”。如果证据不足，应补 Eval/Trace，而不是直接跳到下一阶段。` : "我会基于当前项目证据解释原因，并给出下一步可执行动作。",
        suggestedAction: suggested.action,
        suggestedActionLabel: suggested.label,
        evidence: ["当前 Stage", "项目 Gate 状态", "Baseline / Diagnosis / Experiment / Release 数据"],
      });
    }
    case "evaluate": {
      const testCases = Array.isArray(p.testCases) ? p.testCases as Array<{ id?: string; criterionIds?: string[] }> : [];
      const rubric = Array.isArray(p.acceptanceRubric) ? p.acceptanceRubric as Array<{ id?: string; minScore?: number }> : [];
      return EvaluateAiResultSchema.parse({
        accuracy: 90, evidence: 86, riskCoverage: 82, completeness: 89, safety: "PASS",
        notes: ["关键事实基本正确", "大部分结论已绑定来源"], failures: ["少量长上下文案例仍有引用遗漏"],
        cases: testCases.map((item) => ({ testCaseId: item.id || "demo-case", accuracy: 90, evidence: 86, completeness: 89, reason: "Demo evaluator" })),
        criteria: rubric.map((criterion) => ({ criterionId: criterion.id || "DEMO", score: 90, pass: 90 >= (criterion.minScore ?? 80), evidence: ["Demo evaluator evidence"], gaps: [], testCaseIds: testCases.filter((testCase) => testCase.criterionIds?.includes(criterion.id || "")).map((testCase) => testCase.id || "demo-case") })),
      });
    }
    case "gap-cluster": {
      // 演示模式按扣分原因的关键词特征归堆；真实项目由评审模型给出更准的共同病因。
      type Worsened = { testCaseId?: string; reason?: string; candidateFailed?: boolean };
      const items = Array.isArray(p.worsenedCases) ? p.worsenedCases as Worsened[] : [];
      const buckets: Array<{ match: (item: Worsened) => boolean; name: string; pattern: string; advice: string }> = [
        { match: (item) => Boolean(item.candidateFailed) || /执行失败|超时|timeout/i.test(String(item.reason ?? "")), name: "执行稳定性问题", pattern: "演示引擎特征：这类题目在候选执行阶段直接失败，按未完成任务计分，是总分差里最重的一块。", advice: "先回方案页删掉可能引发超时/崩溃的改动（过长输出、额外工具调用），或给该环节补上兜底路径后重新实验。" },
        { match: (item) => /引用|来源|证据|citation|claim/i.test(String(item.reason ?? "")), name: "证据引用不足", pattern: "演示引擎特征：这类题目的扣分原因集中在结论未绑定可验证来源，与验收标准里的证据要求直接冲突。", advice: "在候选中加强引用/证据类指令（结论必须附带来源），并补充带来源的参考材料后重新出方案。" },
        { match: (item) => /缺失|遗漏|不全|漏/i.test(String(item.reason ?? "")), name: "内容要素缺漏", pattern: "演示引擎特征：这类题目的扣分原因集中在必需输出要素缺失，说明候选对输出结构的约束变弱了。", advice: "回方案页让候选显式列出必需输出要素清单，并在流程末尾加一步自检核对。" },
      ];
      const used = new Set<string>();
      const clusters = buckets.map((bucket) => {
        const caseIds = items.filter((item) => !used.has(String(item.testCaseId)) && bucket.match(item)).map((item) => String(item.testCaseId ?? ""));
        caseIds.forEach((id) => used.add(id));
        return { name: bucket.name, caseIds, pattern: bucket.pattern, advice: bucket.advice };
      }).filter((cluster) => cluster.caseIds.length);
      const rest = items.filter((item) => !used.has(String(item.testCaseId))).map((item) => String(item.testCaseId ?? ""));
      if (rest.length) clusters.push({ name: "零散扣分题", caseIds: rest, pattern: "演示引擎未能识别出共同关键词特征，建议逐题查看扣分原因。", advice: "人工翻看这些题的失分原因；重跑盲测可让评审模型给出更精确的原因。" });
      return GapClusterAiResultSchema.parse({
        clusters,
        overall: clusters.length ? `演示引擎按扣分原因关键词归为 ${clusters.length} 类；真实项目由评审模型给出更准的共同病因。` : "没有可归类的落后题目。",
      });
    }
    case "gap-advice": {
      // 演示引擎按差距维度与检查项生成建议；真实项目由顾问模型结合逐题证据给出更具体方案。
      type Dim = { label?: string; diff?: number; exceeded?: boolean };
      const dimensions = Array.isArray((p.gap as { dimensions?: Dim[] } | undefined)?.dimensions) ? (p.gap as { dimensions: Dim[] }).dimensions : [];
      const failedCheck = Array.isArray(p.checks) ? (p.checks as Array<{ label?: string; status?: string; detail?: string }>).filter((check) => check.status === "fail") : [];
      const actions: Array<{ title: string; detail: string; target: string }> = [];
      for (const dimension of dimensions.filter((item) => item.exceeded).slice(0, 2)) {
        if (dimension.label === "准确率") actions.push({ title: "加强结论正确性约束", detail: `本轮${dimension.label}落后基线 ${Math.round(dimension.diff ?? 0)} 分：回方案页在候选中补充「关键结论必须逐条核对后再输出」的自检指令，并为高频错误场景补充带来源的参考材料。`, target: "Prompt" });
        else actions.push({ title: "补全任务要素清单", detail: `本轮${dimension.label}落后基线 ${Math.round(dimension.diff ?? 0)} 分：让候选显式列出必需输出要素并在结尾逐项核对，避免要素遗漏拖低完成度。`, target: "Workflow" });
      }
      const holdout = p.holdout as { averageCost?: number } | undefined;
      if (!failedCheck.length && !dimensions.some((item) => item.exceeded)) {
        actions.push({ title: "保持并固化有效改动", detail: "各项差距均在容差内：将本轮候选的有效改动沉淀为 Lesson/Skill，进入发布流程。", target: "Memory" });
      } else if ((holdout?.averageCost ?? 0) > 0.3) {
        actions.push({ title: "控制验证成本", detail: `平均成本 ¥${holdout?.averageCost}：给候选加输出长度与重试次数上限，避免进化以成本换分数。`, target: "Workflow" });
      }
      actions.push({ title: "回方案页换稳态候选", detail: "基于上方「同卷差距归因」的主因题重新生成候选，优先选择对主因题直接加强的低改动方案。", target: "Prompt" });
      return GapAdviceAiResultSchema.parse({
        overall: failedCheck.length
          ? `演示引擎诊断：本轮未通过集中在${failedCheck.map((check) => check.label).join("、")}，结合维度差距应优先补强候选的稳定性与要素完整性，而非整体重写。`
          : "演示引擎诊断：本轮整体达标，建议固化有效改动并进入发布流程。",
        actions,
      });
    }
    case "visual-judge": {
      // 演示引擎没有真实视觉模型：给出保守占位评分并显式标注，避免冒充真实视觉评审。
      return VisualJudgeAiResultSchema.parse({
        scores: { usability: 60, aesthetics: 60, responsiveness: 55, interaction: 60 },
        summary: "演示引擎（未连接真实视觉模型）给出的占位视觉评审：仅证明链路可用，分数不代表真实 UI/UX 水平；在设置中连接视觉模型后重跑可获得真实评审。",
        findings: [
          "当前评审由内置演示引擎产出，未使用真实视觉模型。",
          "截图已保存为项目视觉证据，可用于人工评审与后续真实 Visual Judge 复跑。",
        ],
      });
    }
    default:
      throw new Error(`Unsupported demo AI operation: ${operation}`);
  }
}
