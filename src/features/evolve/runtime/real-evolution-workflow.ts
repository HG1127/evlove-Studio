import type { EvolveProject, Stage } from "../schemas";
import { deliveryReadiness } from "./delivery-readiness";
import { resolveProjectArtifactStrategy } from "./artifact-strategy";
import { repositoryGoalCoverageForProject } from "../sources/repository-intelligence";
import { baselineReadiness } from "./baseline-readiness";

export type UserEvolutionStepId = "understand" | "diagnose" | "evolve" | "verify" | "deliver";

export type UserEvolutionStep = {
  id: UserEvolutionStepId;
  label: string;
  question: string;
  input: string;
  action: string;
  output: string;
  done: string;
  stages: Stage[];
  entry: Stage;
};

export type UserStageEvidence = {
  read: string[];
  findings: string[];
  outputs: string[];
  next: string;
};

const map: Record<UserEvolutionStepId, { stages: Stage[]; entry: Stage }> = {
  understand: { stages: ["target", "baseline"], entry: "target" },
  diagnose: { stages: ["problem", "diagnosis"], entry: "problem" },
  evolve: { stages: ["plan", "experiment"], entry: "plan" },
  verify: { stages: ["validation"], entry: "validation" },
  deliver: { stages: ["release", "learning"], entry: "release" },
};

function objectName(project: EvolveProject) {
  return project.semanticEvolution?.semanticObject.label || resolveProjectArtifactStrategy(project).shortLabel || "成果物";
}

function artifactReadSummary(project: EvolveProject) {
  const items: string[] = [];
  for (const artifact of project.sourceArtifacts.filter((item) => item.role === "target")) {
    const structured = artifact.structuredContent as Record<string, unknown> | undefined;
    if (artifact.artifactKind === "codebase") {
      const repo = structured?.repositoryIntelligence as { deepIndexedEntries?: number; eligibleEntries?: number; criticalModules?: Array<{ path: string }> } | undefined;
      const critical = repo?.criticalModules?.slice(0, 4).map((item) => item.path).filter(Boolean) ?? [];
      items.push(`${artifact.name}：已建立工程索引${repo?.deepIndexedEntries ?? artifact.structure.length}/${repo?.eligibleEntries ?? artifact.structure.length}；重点模块 ${critical.join("、") || "已按用户目标动态检索"}`);
      continue;
    }
    if (artifact.artifactKind === "presentation") {
      const slides = (structured?.slides as Array<unknown> | undefined)?.length ?? 0;
      items.push(`${artifact.name}：已读取 ${slides || artifact.structure.length || "数量未知的"} 页及文本层级`);
      continue;
    }
    if (artifact.artifactKind === "spreadsheet") {
      const sheets = (structured?.sheets as Array<{ name?: string }> | undefined) ?? [];
      items.push(`${artifact.name}：已读取 ${sheets.length || artifact.structure.length || "数量未知的"} 个工作表${sheets.length ? `（${sheets.slice(0, 5).map((sheet) => sheet.name).filter(Boolean).join("、")}）` : ""}`);
      continue;
    }
    if (artifact.artifactKind === "document") {
      const parts = (structured?.parts as Array<{ path?: string }> | undefined) ?? [];
      items.push(`${artifact.name}：已读取正文与 ${parts.length || artifact.structure.length || "数量未知的"} 个结构段`);
      continue;
    }
    const structureCount = artifact.structure.length;
    items.push(`${artifact.name}：${structureCount ? `已读取 ${structureCount} 个结构项` : "已读取当前可解析内容"}`);
  }
  return items.slice(0, 8);
}

function requirementEvidence(project: EvolveProject) {
  const codeCoverage = repositoryGoalCoverageForProject(project);
  const rows = codeCoverage.flatMap((item) => item.anchors.map((anchor) => ({ label: anchor.label, coverage: anchor.coverage, paths: anchor.evidencePaths })));
  if (rows.length) return rows.slice(0, 6).map((row) => `${row.label}：证据覆盖 ${Math.round(row.coverage * 100)}%${row.paths.length ? ` · ${row.paths.slice(0, 3).join("、")}` : ""}`);
  return project.acceptanceRubric.slice(0, 6).map((criterion) => `${criterion.title}：${criterion.requirement}`);
}

export function compileUserEvolutionSteps(project: EvolveProject): UserEvolutionStep[] {
  const object = objectName(project);
  const semanticStages = project.semanticEvolution?.workflowStages ?? [];
  const semantic = (id: string) => semanticStages.find((item) => item.id === id);
  const define = semantic("define");
  const diagnose = semantic("diagnose");
  const evolve = semantic("evolve");
  const verify = semantic("verify");
  const deliver = semantic("deliver");
  return [
    {
      id: "understand", label: "理解材料与目标", question: "系统是否理解了你想改什么、哪些内容不能动？",
      input: define?.input || `当前${object} + 你的改进要求`,
      action: "确认目标、必须保留的内容，并记录当前版本表现",
      output: "确认后的目标 + 当前版本体检结果",
      done: "目标、边界和当前表现都已确认，可以开始找问题",
      ...map.understand,
    },
    {
      id: "diagnose", label: "找出改进重点", question: "当前最值得先改什么，为什么会出现这个问题？",
      input: diagnose?.input || "当前成果 + 你的目标 + 体检结果",
      action: "找出最影响目标的问题，并分析为什么发生",
      output: "本轮重点问题 + 主要原因",
      done: "已经明确这一轮要解决的问题和主要原因",
      ...map.diagnose,
    },
    {
      id: "evolve", label: "生成并比较新版", question: "哪一种改法实际效果更好？",
      input: evolve?.input || "已确认的问题和原因 + 当前成果",
      action: "生成几个实际新版，并在相同条件下比较",
      output: "可选择的新版 + 对比结果 + 当前推荐版本",
      done: "至少得到一个可以实际使用并继续验收的新版本",
      ...map.evolve,
    },
    {
      id: "verify", label: "检查改进效果", question: "新版是真的变好，还是只在已知测试里看起来更好？",
      input: verify?.input || "推荐新版 + 新测试场景 + 你的要求",
      action: "用系统没提前见过的场景检查新版，并确认内容、格式和必须保留的部分没有被破坏",
      output: "是否真的变好 + 哪些地方仍需补证或修复",
      done: "核心要求达到，成果完整，可以交付",
      ...map.verify,
    },
    {
      id: "deliver", label: "交付与继续进化", question: "最终成果是否已经可以直接使用？",
      input: deliver?.input || "已经验收通过的最佳版本",
      action: "交付已经验收过的同一份最佳版本，需要线上运行时再逐步上线",
      output: "最终成果 + 改动说明 + 验收结果 + 版本记录",
      done: "拿到的就是刚刚验收通过的同一版本",
      ...map.deliver,
    },
  ];
}

export function stepForStage(project: EvolveProject, stage: Stage) {
  return compileUserEvolutionSteps(project).find((step) => step.stages.includes(stage))!;
}

export function stepUnlocked(project: EvolveProject, id: UserEvolutionStepId) {
  switch (id) {
    case "understand": return true;
    case "diagnose": return baselineReadiness(project).ready;
    case "evolve": return stepCompleted(project, "diagnose");
    case "verify": return stepCompleted(project, "evolve");
    case "deliver": return deliveryReadiness(project).ready;
  }
}

export function stepCompleted(project: EvolveProject, id: UserEvolutionStepId) {
  switch (id) {
    case "understand": return baselineReadiness(project).ready;
    case "diagnose": return baselineReadiness(project).ready && Boolean(project.selectedProblemId && project.diagnosis?.problemId === project.selectedProblemId && project.diagnosis.rootCause.trim() && project.diagnosis.evidence.length && (!project.diagnosis.evidenceRefs.length || project.diagnosis.evidenceRefs.some((ref) => ref.verified)));
    case "evolve": {
      const candidateId = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
      const result = project.experimentRun.candidateResults.find(item => item.candidateId === candidateId);
      return project.experimentRun.status === "completed" && Boolean(result && result.experimentStage === "finalist" && result.artifactSnapshots.length && result.evaluation.safety !== "FAIL" && !result.evaluation.demoJudged);
    }
    case "verify": return deliveryReadiness(project).ready;
    case "deliver": { const primary = project.outputArtifacts.filter((item) => item.kind === "primary"); return deliveryReadiness(project).ready && primary.length > 0 && primary.every((item) => item.candidateId === project.experimentRun.winnerId && item.accepted && item.frozenArtifact); }
  }
}

export function preferredInternalStage(project: EvolveProject, id: UserEvolutionStepId): Stage {
  if (id === "understand") return project.gates.find((gate) => gate.id === "target-ready")?.status === "approved" ? "baseline" : "target";
  if (id === "diagnose") return project.selectedProblemId ? "diagnosis" : "problem";
  if (id === "evolve") return project.candidates.length && project.gates.some(gate => gate.id === "experiment-ready" && gate.status === "approved") ? "experiment" : "plan";
  if (id === "verify") return "validation";
  return "release";
}

export function humanStageEvidence(project: EvolveProject, id: UserEvolutionStepId): UserStageEvidence {
  const object = objectName(project);
  if (id === "understand") {
    return {
      read: artifactReadSummary(project),
      findings: [
        `业务对象：${object}`,
        `用户目标：${project.semanticEvolution?.intent.summary || project.evolutionCommand || project.goal}`,
        ...requirementEvidence(project).slice(0, 4),
      ],
      outputs: [`${project.acceptanceRubric.length} 条项目专属验收标准`, `${project.evalSuite.length || "待生成"} 道可见测试 / ${project.hiddenEvalSuite.length || "待生成"} 道隐藏测试`, project.baselineRun.status === "completed" ? "当前版本基线已建立" : "等待建立当前版本基线"],
      next: project.baselineRun.status === "completed" ? "进入差距诊断：找出最值得改的问题。" : "先确认验收标准并运行当前版本基线。",
    };
  }
  if (id === "diagnose") {
    const selected = project.problems.find((item) => item.id === project.selectedProblemId) ?? project.problems[0];
    return {
      read: [project.baselineRun.result ? `基线结果：准确 ${project.baselineRun.result.accuracy}% / 完整 ${project.baselineRun.result.completeness}%` : "基线结果尚未完成", `${project.baselineRun.runs.length} 条实际运行记录 / Trace`, ...artifactReadSummary(project).slice(0, 3)],
      findings: selected ? [`优先问题：${selected.title}`, `影响：${selected.impact}% · 严重度 ${selected.severity}`, project.diagnosis ? `根因：${project.diagnosis.rootCause}` : "等待根因诊断"] : ["等待从基线失败中聚类问题"],
      outputs: [project.problems.length ? `${project.problems.length} 个问题簇` : "问题地图待生成", project.diagnosis ? `根因置信度 ${Math.round(project.diagnosis.confidence * 100)}%` : "根因待生成", project.diagnosis ? `${project.diagnosis.evidence.length} 条支持证据 + 反证条件` : ""].filter(Boolean),
      next: project.diagnosis ? "针对已确认根因生成多个真实新版。" : "先把‘发生了什么’和‘为什么发生’分开确认。",
    };
  }
  if (id === "evolve") {
    const candidateId = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
    const winner = project.candidates.find((item) => item.id === candidateId);
    return {
      read: [project.diagnosis ? `根因：${project.diagnosis.rootCause}` : "根因尚未就绪", ...artifactReadSummary(project).slice(0, 4)],
      findings: project.candidates.length ? project.candidates.slice(0, 5).map((item) => `${item.id}：${item.title || item.change}`) : ["等待生成多种进化方案"],
      outputs: [project.candidates.length ? `${project.candidates.length} 个 Candidate` : "Candidate 待生成", winner ? `当前实验最佳：${winner.id} · ${winner.title || winner.name}` : "等待同条件实验选优", winner?.artifactSnapshots?.length ? `最佳版本已形成 ${winner.artifactSnapshots.length} 个真实成果快照` : ""].filter(Boolean),
      next: winner ? "进入真实验收：用 Hidden 场景和项目专属标准验证这个版本。" : "先生成完整新版，再在相同测试条件下比较。",
    };
  }
  if (id === "verify") {
    const acceptance = project.artifactAcceptance;
    const failed = acceptance.results.filter((item) => !item.pass && !project.validationRun.evaluation?.unverifiedCriterionIds?.includes(item.criterionId));
    const validationFailed = project.validationRun.checks.filter((item) => item.status === "fail");
    const unverifiedIds = new Set(project.validationRun.evaluation?.unverifiedCriterionIds ?? []);
    const unverified = acceptance.results.filter((item) => unverifiedIds.has(item.criterionId));
    const criterionTitle = (criterionId: string) => project.acceptanceRubric.find((criterion) => criterion.id === criterionId)?.title ?? criterionId;
    const planned = project.validationRun.plannedCases ?? project.hiddenEvalSuite.length;
    const executed = project.validationRun.executedCases ?? project.validationRun.runs.length;
    const fastGate = project.validationRun.validationMode === "fast-gate" || (executed > 0 && executed < planned && /Fast Gate|快速阻断/.test(project.validationRun.summary ?? ""));
    return {
      read: [fastGate ? `快速阻断检查：已执行 ${executed}/${planned} 个未知场景` : `完整隐藏验证：${executed || planned}/${planned} 个未知场景`, `${project.acceptanceRubric.length} 条项目专属验收标准`, "被测试的是 Candidate 完整成果快照，不是修改说明"],
      findings: [project.validationRun.status === "completed" ? `Hidden 结论：${project.validationRun.recommendation ?? "hold"}` : "Hidden Validation 尚未完成", acceptance.status === "passed" ? `成果验收通过 · ${acceptance.overallScore.toFixed(0)} 分` : acceptance.status === "failed" ? `成果验收未通过 · ${failed.length} 项失败` : acceptance.status === "unverified" ? acceptance.summary : "成果验收待完成", unverified.length ? `${unverified.length} 项缺少真实 Runner/视觉证据，明确标记为待验证` : ""].filter(Boolean),
      outputs: [`Hard Gate：${acceptance.hardGatePass ? "通过" : "未通过/待验证"}`, validationFailed.length ? `已有证据的失败项：${validationFailed.slice(0, 3).map((item) => item.label.replace(/^Hard Gate · /, "")).join("、")}` : failed.length ? `失败项：${failed.slice(0, 3).map((item) => criterionTitle(item.criterionId)).join("、")}` : "没有已证实的失败项", unverifiedIds.size ? `待补证据：${[...unverifiedIds].slice(0, 3).map(criterionTitle).join("、")}` : ""].filter(Boolean),
      next: deliveryReadiness(project).ready ? "冻结这份已经验收过的成果，进入交付。" : validationFailed.length || failed.length ? "保留已经通过的内容，只修复已有证据的失败项，再重新验收。" : "先补齐缺少的运行、视觉或人工证据，再继续验收；无需盲目重写成果。",
    };
  }
  return {
    read: [project.searchChampion ? `Best-Ever：${project.searchChampion.versionLabel} · ${project.searchChampion.score.toFixed(1)} 分` : "当前最佳版本", project.outputArtifacts.length ? `${project.outputArtifacts.length} 个可交付成果文件` : "成果物等待物化"],
    findings: [project.release.status !== "idle" ? `发布状态：${project.release.status}` : "尚未进入真实发布", project.lessons.length ? `已沉淀 ${project.lessons.length} 条经验` : "经验待沉淀"],
    outputs: [project.outputArtifacts.length ? `最终成果：${project.outputArtifacts.slice(0, 4).map((item) => item.name).join("、")}` : "等待生成同格式成果包", "附带验收报告、版本差异和血缘记录"],
    next: project.outputArtifacts.some((item) => item.accepted) ? "用户可以下载并继续使用这份已验收成果。" : "先物化已验收的同一 Candidate Snapshot，再交付。",
  };
}

/** User-facing state is derived from evidence, independently from which page is being viewed. */
export function workflowStepState(project: EvolveProject, id: UserEvolutionStepId) {
  const complete = stepCompleted(project, id);
  const unlocked = stepUnlocked(project, id);
  const blockedBy: Record<UserEvolutionStepId, string> = {
    understand: "", diagnose: `先建立可信的当前版本基线。${baselineReadiness(project).blockers.join("；")}`,
    evolve: "先选定本轮要解决的问题，并确认主要原因。",
    verify: "先生成并比较实际新版；系统必须先形成真实候选文件，再选出一个值得进一步验收的版本。",
    deliver: project.validationRun.status === "idle" ? "先确认新版确实变好且成果完整，再进入交付。" : deliveryReadiness(project).reasons.join("；"),
  };
  if (!unlocked) return { status: "locked" as const, label: "待前置步骤", detail: blockedBy[id] };
  if (complete) return { status: "complete" as const, label: "已完成", detail: "可查看结果；修改输入后需要重新验证。" };
  if (id === "evolve" && project.experimentRun.status === "failed") return { status: "attention" as const, label: "需要处理", detail: project.experimentRun.summary || "实验未完成，查看失败原因后重试。" };
  if (id === "evolve" && project.experimentRun.status === "completed" && project.experimentRun.pendingEvidenceCandidateId) return { status: "complete" as const, label: "候选已生成，等待真实验收", detail: "候选没有已证实的产品失败；系统会保留同一成果快照进入最终验收，不会重复改写。" };
  if (id === "evolve" && project.experimentRun.status === "completed") return { status: "attention" as const, label: "这轮没有更好的版本", detail: "当前版本保持不变。系统会根据失败原因自动调整下一轮。" };
  if (id === "verify") {
    const failedChecks = project.validationRun.checks.filter((item) => item.status === "fail").length;
    const pendingEvidence = project.validationRun.evaluation?.unverifiedCriterionIds?.length ?? 0;
    if (project.validationRun.status === "failed" || project.validationRun.recommendation === "reject" || project.artifactAcceptance.status === "failed" || failedChecks > 0) {
      return { status: "attention" as const, label: "尚未达标", detail: `${failedChecks || 1} 项已有证据的失败；${pendingEvidence} 项待补证据。保留已通过内容，只修复失败项。` };
    }
    if (project.artifactAcceptance.status === "unverified" || project.validationRun.recommendation === "hold") return { status: "attention" as const, label: "待补验证条件", detail: `${pendingEvidence} 项需要运行、视觉或人工证据；当前未判定成果失败。` };
  }
  return { status: "ready" as const, label: "可以继续", detail: "本步骤准备就绪，按下方操作推进。" };
}
