import type { AcceptanceCriterion, EvolveProject, TestCase } from "@evolution/contracts";
import { artifactStrategyCriteria, resolveProjectArtifactStrategy } from "./artifact-strategy";
import { projectSupportsLocalDocumentSnapshot } from "./criterion-evidence";
export { rubricCoverage, rubricSuiteCoverage, rubricValidation, rubricWeightTotal } from "./rubric-readiness";

const SYSTEM_CRITERIA: AcceptanceCriterion[] = [
  {
    id: "SYS-INTEGRITY",
    title: "成果完整性",
    requirement: "最终成果必须完整、无截断、无占位符、无未处理 TODO，且不能因进化丢失未授权内容。",
    source: "system-integrity",
    weight: 8,
    hardGate: true,
    judgeType: "integrity",
    validationMethod: "static-structure",
    minScore: 95,
    evidenceExpected: ["完整成果", "无 truncation / placeholder / unresolved TODO"],
    protectedConstraint: true, artifactIds: [], category: "integrity",
  },
  {
    id: "SYS-PAIRWISE",
    title: "相对原版真实改进",
    requirement: "最终成果必须相对原始版本更符合用户进化目标，不能只增加解释、测试话术或包装文字。",
    source: "system-integrity",
    weight: 7,
    hardGate: true,
    judgeType: "pairwise",
    validationMethod: "semantic-judge",
    minScore: 85,
    evidenceExpected: ["Original vs Evolved 对比", "核心用户要求有可定位变化"],
    protectedConstraint: false, artifactIds: [], category: "outcome",
  },
];

const INTERNAL_COUPLING = /(src\/|docs\/|\.tsx?\b|\.jsx?\b|\.test\.|\.spec\.|typeid\b|workflow-engine|artifact-compatibility|semantic-evolution|tailwind|css\s*token|theme\s*token|index\.css|schema\.ts|function\s+[a-z_$]|\bundefined\s*断点|具体文件名|内部实现文件)/i;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
}

function keywords(value: string) {
  return [...new Set(normalizeText(value).split(/\s+/).filter((item) => item.length >= 2))];
}

function similarity(a: string, b: string) {
  const ka = keywords(a);
  const kb = new Set(keywords(b));
  if (!ka.length || !kb.size) return 0;
  return ka.reduce((sum, token) => sum + (kb.has(token) ? 1 : 0), 0) / Math.max(ka.length, kb.size);
}

function criterionText(item: AcceptanceCriterion) {
  return `${item.title} ${item.requirement} ${item.evidenceExpected.join(" ")}`;
}

function validationMethodFor(item: AcceptanceCriterion): AcceptanceCriterion["validationMethod"] {
  if (item.validationMethod) return item.validationMethod;
  if (item.judgeType === "integrity") return "static-structure";
  if (item.judgeType === "pairwise") return "semantic-judge";
  return "semantic-judge";
}

function implementationCoupled(item: AcceptanceCriterion, command: string) {
  if (!INTERNAL_COUPLING.test(criterionText(item))) return false;
  // 用户如果明确点名实现文件/符号，则允许它成为验收项；否则实现细节只能作为证据，不能反客为主成为产品目标。
  const internalTokens = criterionText(item).match(/[\w.-]+\.(?:ts|tsx|js|jsx|json|md|css)|src\/[\w/.-]+|docs\/[\w/.-]+|typeid/gi) ?? [];
  const normalizedCommand = normalizeText(command);
  return !internalTokens.some((token) => normalizedCommand.includes(normalizeText(token)));
}

function dedupeCriteria(items: AcceptanceCriterion[]) {
  const kept: AcceptanceCriterion[] = [];
  for (const item of items) {
    const duplicateIndex = kept.findIndex((existing) => existing.id === item.id || similarity(criterionText(existing), criterionText(item)) >= 0.62);
    if (duplicateIndex < 0) {
      kept.push(item);
      continue;
    }
    const existing = kept[duplicateIndex]!;
    // 用户来源 > 语义推导 > 系统默认；Hard Gate 和更丰富 evidenceExpected 优先保留。
    const sourceRank = (criterion: AcceptanceCriterion) => criterion.source === "user-command" ? 4 : criterion.source === "source-understanding" ? 3 : criterion.source === "protected-item" ? 2 : 1;
    const candidateRank = sourceRank(item) * 10 + (item.hardGate ? 3 : 0) + Math.min(2, item.evidenceExpected.length);
    const existingRank = sourceRank(existing) * 10 + (existing.hardGate ? 3 : 0) + Math.min(2, existing.evidenceExpected.length);
    if (candidateRank > existingRank) kept[duplicateIndex] = item;
  }
  return kept;
}

function chooseUserCriteria(items: AcceptanceCriterion[], max = 4) {
  return [...items]
    .sort((a, b) => (b.hardGate ? 1 : 0) - (a.hardGate ? 1 : 0) || b.weight - a.weight || b.evidenceExpected.length - a.evidenceExpected.length)
    .slice(0, max);
}


function commandDerivedCriteria(command: string, project?: RubricProjectInput): AcceptanceCriterion[] {
  const value = command.trim();
  if (!value) return [];
  const criteria: AcceptanceCriterion[] = [];
  const push = (id: string, title: string, requirement: string, method: AcceptanceCriterion["validationMethod"], evidence: string[], minScore = 90) => {
    criteria.push({
      id, title, requirement, source: "user-command", weight: 25, hardGate: true,
      judgeType: method === "visual-review" ? "llm" : method === "format-roundtrip" ? "integrity" : "llm",
      validationMethod: method, minScore, evidenceExpected: evidence, protectedConstraint: false, artifactIds: [], category: "outcome",
    });
  };
  if (/(成果物|文件|材料).{0,10}(输入|上传|接入|兼容)|输入.{0,8}(兼容|适配)|多(种|类型).{0,8}(成果|文件)|兼容.{0,8}(成果|文件)/i.test(value)) {
    push("USER-INPUT-COMPAT", "成果物输入兼容", "系统应能让真实用户导入不同类型/结构的成果物，正确完成解析、类型/业务对象理解和后续路由；解析器能力缺失不得被伪装成成果本身失败。", "user-scenario", ["代表性成果物可成功导入", "解析结果与实际结构一致", "不同成果进入正确自适应流程", "不支持能力明确标记为未验证/需插件"], 92);
  }
  if (/(流程|工作流).{0,10}(完整|闭环|清晰|顺畅)|完整.{0,6}(流程|闭环)|闭环/i.test(value)) {
    // A written SOP describes a workflow; it does not run Evolution OS or deploy its examples.
    // Keep the stable criterion ID, but bind the corrected contract to a new evidence fingerprint.
    const documentWorkflow = project && projectSupportsLocalDocumentSnapshot(project)
      && project.semanticEvolution?.semanticObject.typeId !== "software-system";
    push("USER-WORKFLOW-CLOSURE", "流程完整闭环", documentWorkflow
      ? "文档中描述的业务或操作流程应完整、可理解、可复现：各步骤的前置条件、输入、操作、输出与完成检查明确，前一步结果衔接后一步，并说明常见异常、重试或回退路径。只检查当前文档实际写明的内容；真实系统运行、部署或真人实操需另设对应验收项。"
      : "用户从输入、理解、诊断、进化、验证到交付应形成可理解、可继续、可回退的闭环；问题、原因、动作、结果和下一步必须分明。",
      documentWorkflow ? "semantic-judge" : "user-scenario", documentWorkflow
        ? ["关键步骤写明前置条件、输入、操作、输出与完成检查", "前后步骤与配置结果能衔接，无遗漏或自相矛盾", "常见异常有具体处理、重试或回退说明", "证据引用当前文档中的实际步骤与检查清单"]
        : ["关键阶段均有明确输入/动作/输出/完成条件", "失败/未验证/通过三种状态可区分", "前一阶段产出成为后一阶段输入", "存在可恢复/重试/回退路径"], 92);
  }
  if (/(ui\s*\/?\s*ux|uiux|界面|产品审美|操作习惯|易用|易上手|交互)/i.test(value)) {
    push("USER-UIUX", "UI/UX 与操作习惯", "界面应符合主流产品的信息层级与操作习惯，用户无需理解底层 AI 工程术语也能知道当前状态、主要动作、失败原因和下一步。", "visual-review", ["关键页面视觉层级清晰", "主操作突出且无重复/冲突入口", "状态/等待/失败/未验证有明确反馈", "核心流程普通业务用户可理解"], 88);
  }
  if (/(质量|成果|输出).{0,8}(完整|提升|更好)|最终成果|进化后成果/i.test(value)) {
    push("USER-OUTPUT-QUALITY", "最终成果质量", "最终交付必须是实际进化后的完整成果快照，实质满足用户目标，而不是说明文字、测试话术或 Patch 摘要。", "semantic-judge", ["最终成果可直接使用/继续编辑", "变化可定位到用户目标", "内容完整且非占位/说明型输出"], 92);
  }
  // 如果命令没有命中常见产品维度，仍保留一条“原始用户要求”作为不可丢失的锚点。
  if (!criteria.length) {
    push("USER-PRIMARY-INTENT", "用户原始进化要求", value.slice(0, 1200), "semantic-judge", ["最终成果逐项回应原始用户要求", "未满足项必须显式列出而非默认为通过"], 90);
  }
  return criteria.slice(0, 4);
}

/** Canonicalize a provisional AI ID only when a sole Target makes its meaning unique. */
function bindUniqueDraftTarget(
  criterion:AcceptanceCriterion,
  project?:RubricProjectInput,
):AcceptanceCriterion{
  const ids=criterion.artifactIds??[];
  if(!project||ids.length!==1)return criterion;
  // Once any attempt/evidence has been recorded, a scope correction changes the
  // acceptance fingerprint and must be an explicit new contract version.
  if(project.candidates?.length || (project.baselineRun && project.baselineRun.status!=="idle")
    || (project.campaign && project.campaign.currentRound>0))return criterion;
  const targets=project.sourceArtifacts.filter(source=>source.role==="target");
  // A valid reference ID is intentionally not reinterpreted as a Target.
  if(targets.length!==1||project.sourceArtifacts.some(source=>source.id===ids[0]))return criterion;
  return {...criterion,artifactIds:[targets[0]!.id]};
}

function chooseArtifactCriteria(items: AcceptanceCriterion[], max = 3) {
  const chosen: AcceptanceCriterion[] = [];
  const methodSeen = new Set<string>();
  for (const item of [...items].sort((a, b) => (b.hardGate ? 1 : 0) - (a.hardGate ? 1 : 0) || b.weight - a.weight)) {
    const key = `${item.validationMethod}:${item.category}`;
    if (methodSeen.has(key) && chosen.length >= 2) continue;
    chosen.push(item);
    methodSeen.add(key);
    if (chosen.length >= max) break;
  }
  return chosen;
}

export type RubricProjectInput = Pick<EvolveProject, "protectedItems" | "sourceArtifacts"> & Partial<Pick<EvolveProject, "semanticEvolution" | "evolutionCommand" | "candidates" | "baselineRun" | "campaign">>;

export function normalizeAcceptanceRubric(input: AcceptanceCriterion[], project?: RubricProjectInput) {
  const command = project?.evolutionCommand ?? "";
  const base: AcceptanceCriterion[] = [];
  const ids = new Set<string>();
  for (const raw of input) {
    const id = raw.id.trim() || `REQ-${base.length + 1}`;
    if (/^PROTECT-(?:\d+|ALL)$/i.test(id)) continue;
    const normalized: AcceptanceCriterion = {
      ...raw,
      id,
      title: raw.title.trim() || id,
      requirement: raw.requirement.trim(),
      weight: Math.max(0, raw.weight),
      minScore: Math.max(0, Math.min(100, raw.minScore)),
      validationMethod: validationMethodFor(raw),
      artifactIds: raw.artifactIds ?? [],
      category: raw.category ?? "outcome",
    };
    if (!normalized.requirement || ids.has(id)) continue;
    if ((normalized.source === "user-command" || normalized.source === "source-understanding") && implementationCoupled(normalized, command)) continue;
    ids.add(id);
    base.push(bindUniqueDraftTarget(normalized,project));
  }

  const semantic = project?.semanticEvolution?.acceptanceRubric ?? [];
  const artifact = project ? artifactStrategyCriteria(project.sourceArtifacts) : [];
  const targets = project?.sourceArtifacts.filter((item) => item.role === "target") ?? [];

  // Semantic criteria are useful defaults, but must not duplicate the user's explicit project rubric or the artifact/system integrity gates.
  const hasExplicitUserGoal = base.some((item) => item.source === "user-command" && item.id !== "SEM-USER-GOAL");
  const hasFormatArtifactGate = artifact.some((item) => item.validationMethod === "format-roundtrip");
  const semanticFiltered = semantic.filter((item) => {
    if (item.id === "SEM-USER-GOAL" && hasExplicitUserGoal) return false;
    if (item.id === "SEM-FORMAT" && hasFormatArtifactGate) return false;
    if (item.id === "SEM-INTEGRITY") return false; // SYS-INTEGRITY already owns this responsibility.
    if (item.id === "SEM-CROSS-CONSISTENCY" && targets.length <= 1 && !item.requirement.trim()) return false;
    return true;
  }).map((item) => bindUniqueDraftTarget({ ...item, validationMethod: validationMethodFor(item) },project));

  // If the project already has an explicit user/source-understanding outcome criterion, do not add
  // USER-PRIMARY-INTENT merely as a second wording of the same goal. This migration also repairs
  // persisted projects where an AI criterion such as R-USER-REFINE and the fallback anchor co-exist.
  const explicitUserOutcome = base.some((item) => (item.source === "user-command" || item.source === "source-understanding")
    && item.category === "outcome" && item.validationMethod === "semantic-judge" && item.id !== "USER-PRIMARY-INTENT");
  const commandCriteria = commandDerivedCriteria(command, project).filter((item) => !(explicitUserOutcome && item.id === "USER-PRIMARY-INTENT")).map((item) => {
    const previous = base.find((prior) => prior.id === item.id && criterionText(prior) === criterionText(item)
      && prior.validationMethod === item.validationMethod && prior.minScore === item.minScore
      && prior.hardGate === item.hardGate && prior.source === item.source && prior.category === item.category
      && prior.protectedConstraint === item.protectedConstraint && JSON.stringify(prior.artifactIds) === JSON.stringify(item.artifactIds));
    // Preserve the relative user-goal weights after normalization. Resetting only generated goals
    // to 25 on each pass changes the contract fingerprint every time alongside custom criteria.
    return previous ? { ...item, weight: previous.weight } : item;
  });
  // Generated IDs have one owner. Repeated normalization must not append a stale definition or
  // let previously normalized default system weights compete for user-goal slots.
  const commandCriterionIds = new Set(commandCriteria.map((item) => item.id));
  const systemCriterionIds = new Set(SYSTEM_CRITERIA.map((item) => item.id));
  const artifactCriterionIds = new Set(artifact.map((item) => item.id));
  const baseUserCriteria = base.filter((item) => !commandCriterionIds.has(item.id) && !systemCriterionIds.has(item.id) && !artifactCriterionIds.has(item.id)
    && !item.id.startsWith("SEM-") && item.category !== "artifact-specific"
    && !(explicitUserOutcome && item.id === "USER-PRIMARY-INTENT"));
  const userCandidates = dedupeCriteria([...commandCriteria, ...baseUserCriteria, ...semanticFiltered.filter((item) => item.id === "SEM-USER-GOAL" || item.id === "SEM-BUSINESS-OUTCOME")]);
  const semanticCross = dedupeCriteria(semanticFiltered.filter((item) => item.id === "SEM-CROSS-CONSISTENCY"));
  const artifactCandidates = dedupeCriteria([...artifact.map((item) => ({ ...item, validationMethod: validationMethodFor(item) })), ...semanticCross]);

  const system: AcceptanceCriterion[] = SYSTEM_CRITERIA.map((item) => ({ ...item }));
  if (project?.protectedItems.length) {
    system.push({
      id: "PROTECT-ALL",
      title: `保护边界 · ${project.protectedItems.length} 项`,
      requirement: `以下保护项必须全部保持不变；任意一项破坏都视为 Hard Gate 失败：\n${project.protectedItems.map((item,index)=>`${index+1}. ${item}`).join("\n")}`,
      source: "protected-item",
      weight: 8,
      hardGate: true,
      judgeType: "pairwise",
      validationMethod: "semantic-judge",
      minScore: 95,
      evidenceExpected: project.protectedItems.map((item)=>`与原始版本对比确认未破坏：${item}`),
      protectedConstraint: true, artifactIds: [], category: "protected",
    });
  }

  // Keep the user-facing rubric compact. A typical project now has 7-10 meaningful criteria instead of 15-30 implementation-shaped gates.
  const criteria = dedupeCriteria([
    ...chooseUserCriteria(userCandidates, 4),
    ...chooseArtifactCriteria(artifactCandidates, targets.length > 1 ? 3 : 2),
    ...system,
  ]).slice(0, 10);
  if (!criteria.length) return criteria;

  const strategy = project ? resolveProjectArtifactStrategy(project) : undefined;
  const budgets = strategy ? { user: strategy.userGoalBudget, artifact: strategy.artifactBudget, system: strategy.systemBudget } : { user: 65, artifact: 25, system: 10 };
  const groups = {
    artifact: criteria.filter((item) => item.category === "artifact-specific"),
    system: criteria.filter((item) => item.category !== "artifact-specific" && (item.id.startsWith("SYS-") || item.protectedConstraint || item.source === "protected-item" || item.category === "integrity" || item.category === "protected")),
    user: criteria.filter((item) => item.category !== "artifact-specific" && !(item.id.startsWith("SYS-") || item.protectedConstraint || item.source === "protected-item" || item.category === "integrity" || item.category === "protected")),
  };
  const available = (Object.keys(groups) as Array<keyof typeof groups>).filter((key) => groups[key].length > 0);
  const assigned = { ...budgets };
  const missingBudget = (Object.keys(groups) as Array<keyof typeof groups>).filter((key) => !groups[key].length).reduce((sum, key) => sum + assigned[key], 0);
  if (missingBudget > 0 && available.length) {
    const baseBudget = available.reduce((sum, key) => sum + assigned[key], 0) || available.length;
    for (const key of available) assigned[key] += missingBudget * ((assigned[key] || 1) / baseBudget);
  }

  const normalizedById = new Map<string, AcceptanceCriterion>();
  for (const key of available) {
    const items = groups[key];
    const rawTotal = items.reduce((sum, item) => sum + Math.max(0.1, item.weight), 0) || items.length;
    for (const item of items) normalizedById.set(item.id, { ...item, weight: Number((Math.max(0.1, item.weight) / rawTotal * assigned[key]).toFixed(2)) });
  }
  const normalized = criteria.map((item) => normalizedById.get(item.id) ?? item);
  const drift = 100 - normalized.reduce((sum, item) => sum + item.weight, 0);
  if (normalized.length && Math.abs(drift) >= 0.01) {
    const preferredIndex = normalized.findIndex((item) => groups.user.some((user) => user.id === item.id));
    const index = preferredIndex >= 0 ? preferredIndex : 0;
    normalized[index] = { ...normalized[index]!, weight: Number((normalized[index]!.weight + drift).toFixed(2)) };
  }
  return normalized;
}

function executionModeFor(criterion: AcceptanceCriterion): TestCase["executionMode"] {
  switch (criterion.validationMethod) {
    case "static-structure": return "static-evidence";
    case "format-roundtrip": return "roundtrip";
    case "cross-artifact": return "static-evidence";
    case "visual-review": return "visual-review";
    case "executable-test": return "external-runner";
    case "manual-review": return "manual";
    case "user-scenario":
    case "semantic-judge":
    default: return "artifact-runtime";
  }
}

function evidenceScopeFor(criterion: AcceptanceCriterion): TestCase["evidenceScope"] {
  if (criterion.validationMethod === "format-roundtrip") return "format";
  if (criterion.validationMethod === "cross-artifact") return "cross-artifact";
  if (criterion.validationMethod === "static-structure" || criterion.validationMethod === "executable-test") return "implementation";
  return "product-behavior";
}

function dedicatedCase(criterion: AcceptanceCriterion, hidden: boolean, index: number): TestCase {
  return {
    id: `${hidden ? "holdout" : "validation"}-criterion-${criterion.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${index}`,
    title: `验收：${criterion.title}`,
    input: `从项目最终用户/业务目标视角验证这一条验收标准：${criterion.requirement}`,
    expected: criterion.evidenceExpected.length ? criterion.evidenceExpected : [criterion.requirement],
    tags: ["acceptance", criterion.hardGate ? "hard-gate" : "criterion", criterion.validationMethod],
    hidden,
    criterionIds: [criterion.id],
    executionMode: executionModeFor(criterion),
    evidenceScope: evidenceScopeFor(criterion),
  };
}

/**
 * Bind tests to rubric without forcing unrelated criteria into the nearest-looking test.
 * Low-similarity uncovered criteria get a dedicated deterministic case instead.
 */
export function mapTestsToRubric(criteria: AcceptanceCriterion[], validationCases: TestCase[], hiddenCases: TestCase[]) {
  const known = new Set(criteria.map((criterion) => criterion.id));
  const refreshStoredCase = (item: TestCase, hidden: boolean): TestCase => {
    const criterionIds = item.criterionIds.filter((id) => known.has(id));
    const criterion = criterionIds.length === 1 ? criteria.find((entry) => entry.id === criterionIds[0]) : undefined;
    const generatedPrefix = criterion && `${hidden ? "holdout" : "validation"}-criterion-${criterion.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-`;
    if (criterion && generatedPrefix && item.id.startsWith(generatedPrefix) && /^\d+$/.test(item.id.slice(generatedPrefix.length))) {
      // Auto-created coverage cases follow the current contract; explicit authored scenarios retain
      // their independent expectations. Preserve the test ID so observations remain attributable.
      const refreshed = dedicatedCase(criterion, hidden, 0);
      return { ...item, ...refreshed, id: item.id, tags: [...new Set([...item.tags, ...refreshed.tags])] };
    }
    return { ...item, hidden, criterionIds };
  };
  const visible = validationCases.map((item) => refreshStoredCase(item, false));
  const hidden = hiddenCases.map((item) => refreshStoredCase(item, true));


  const attachIfRelevant = (criterion: AcceptanceCriterion, pool: TestCase[]) => {
    const ranked = pool.filter((item) => item.executionMode === executionModeFor(criterion)).map((item) => ({ item, score: similarity(`${item.title} ${item.input} ${item.expected.join(" ")}`, criterionText(criterion)) })).sort((a,b)=>b.score-a.score);
    const best = ranked[0];
    if (!best || best.score < 0.16) return false;
    best.item.criterionIds = [...new Set([...best.item.criterionIds, criterion.id])];
    return true;
  };

  for (const criterion of criteria) {
    if (!visible.some((item) => item.criterionIds.includes(criterion.id))) {
      if (!attachIfRelevant(criterion, visible)) visible.push(dedicatedCase(criterion, false, visible.length + 1));
    }
  }

  for (const criterion of criteria.filter((item) => item.hardGate)) {
    if (!hidden.some((item) => item.criterionIds.includes(criterion.id))) {
      if (!attachIfRelevant(criterion, hidden)) hidden.push(dedicatedCase(criterion, true, hidden.length + 1));
    }
  }
  return { validationCases: visible, hiddenCases: hidden };
}

export function criterionCoverageByCase(criteria: AcceptanceCriterion[], cases: TestCase[]) {
  return criteria.map((criterion) => ({ criterion, cases: cases.filter((testCase) => testCase.criterionIds.includes(criterion.id)) }));
}
