import type { EvolveProject } from "../schemas";
import { prioritizeProblems } from "@evolution/core";
import { retrieveTextContext, sourceRelevance } from "./context-retrieval";
import { planGroundingContext } from "./plan-grounding";
import type { PlanAiResult } from "../ai/schemas";
import { moduleContext } from "./module-context";
import { projectAtSearchChampion } from "./search-base";

export function limitPlanToTask(project: EvolveProject, result: PlanAiResult): PlanAiResult {
  const count = focusedTask(project).candidateCount;
  const recommended = result.candidates.filter(c => result.recommendedCandidateIds.includes(c.id));
  const ordered = [...recommended, ...result.candidates.filter(c => !result.recommendedCandidateIds.includes(c.id))];
  const candidates = ordered.slice(0, count);
  return { ...result, candidates, recommendedCandidateIds: candidates.map(c => c.id) };
}

/**
 * When Baseline already contains a VERIFIED rubric failure, the problem is no longer an open-ended
 * discovery question. Promote that evidence directly into the round target and save one broad
 * problem-analysis model call. Diagnosis still runs independently to find the implementation cause.
 */
export { baselineRubricProblem, prioritizeProblems } from "@evolution/core";

export function focusedTask(project: EvolveProject) {
  const queue = prioritizeProblems(project.problems);
  const problem = project.problems.find(p => p.id === project.selectedProblemId) ?? queue[0]?.problem;
  const mode = project.campaign.searchMode ?? "focused";
  return {
    problem,
    mode,
    // 聚焦模式保持同一问题边界，但至少比较“保守修复”和“替代机制”两个方案。
    // 单一候选没有搜索能力，一次模型偏差就会让整轮无 Winner。
    candidateCount: mode === "focused" ? Math.min(2, Math.max(1, project.campaign.candidateCount)) : project.campaign.candidateCount,
    title: problem?.title ?? "围绕用户目标查找优先问题",
    scope: problem?.affectedComponent || project.diagnosis?.suggestedScopes.join("、") || "按源证据定位修改区域",
    needsEvidence: Boolean(problem && (!problem.evidence.length || (problem.confidence ?? 0.5) < 0.55
      || (problem.evidenceRefs.length > 0 && !problem.evidenceRefs.some(ref => ref.verified)))),
  };
}

/** A shared budget across artifacts: adding files must not multiply prompt size. */
export function focusedSourceContext(project: EvolveProject, query: string, budget = 24_000) {
  const artifacts = project.sourceArtifacts;
  const ranked = artifacts.map((artifact, index) => ({ artifact, index,
    score: sourceRelevance(artifact.textContent, query) + (artifact.role === "target" ? 2 : 0) + (query.includes(artifact.id) ? 8 : 0)
      + (query.includes(artifact.name) ? 8 : 0)
      + artifact.structure.slice(0, 80).filter(path => query.includes(path)).length * 3,
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = ranked.slice(0, 6);
  // Relevant references must not crowd the artifact being changed out of the context.
  const target = ranked.find(item => item.artifact.role === "target");
  if (target && !selected.some(item => item.artifact.role === "target")) selected[selected.length - 1] = target;
  let remaining = budget;
  const sources = selected.map(({ artifact }, index) => {
    const allowance = Math.max(0, Math.floor(remaining / (selected.length - index)));
    const indexed = moduleContext(artifact, query, allowance);
    const text = indexed?.text || retrieveTextContext(artifact.textContent, query, { maxChars: allowance, maxChunks: 4 });
    remaining -= text.length;
    return { id: artifact.id, name: artifact.name, role: artifact.role, artifactKind: artifact.artifactKind,
      structure: artifact.structure.slice(0, 40), textContent: text,
      coverage: text === artifact.textContent ? "full-text" : "selected-excerpts",
      modules: indexed?.modules, indexedFiles: indexed?.indexedFiles,
      originalChars: artifact.textContent?.length ?? 0 };
  });
  return { sources, budget, usedChars: budget - remaining, totalArtifacts: artifacts.length,
    omittedArtifactIds: ranked.filter(x => !selected.includes(x)).map(x => x.artifact.id),
    limitation: "仅检索相关片段，不代表已检查整个成果；未读取内容不能作为缺陷证据。" };
}

export function buildFocusedPlanPayload(project: EvolveProject, extras: Record<string, unknown> = {}) {
  const task = focusedTask(project);
  const workingProject = projectAtSearchChampion(project);
  const query = [project.evolutionCommand, project.goal, task.title, task.scope,
    project.diagnosis?.rootCause, ...(task.problem?.evidence ?? [])].join(" ");
  const context = focusedSourceContext(workingProject, query);
  const champion = (extras.searchChampion ?? project.searchChampion) as EvolveProject["searchChampion"] | undefined;
  const parentPool = (Array.isArray(extras.parentPool) ? extras.parentPool : []) as Array<{ source?: string; id?: string; label?: string; round?: number; score?: number; niche?: string; patches?: unknown[]; reason?: string }>;
  const archive = (Array.isArray(extras.archive) ? extras.archive : []) as EvolveProject["evolutionArchive"];
  return {
    previousAttemptFailed: extras.previousAttemptFailed,
    searchMemory: extras.searchMemory,
    gapAdvice: extras.gapAdvice,
    gapContext: extras.gapContext,
    search: {
      baseVersionId: champion?.versionLabel ?? project.version,
      parentStrategy: (extras.parentStrategy as string | undefined) ?? project.campaign.parentStrategy,
      exploreRatio: (extras.exploreRatio as number | undefined) ?? project.campaign.exploreRatio,
      champion: champion ? { id: champion.id, versionLabel: champion.versionLabel, round: champion.round, score: champion.score, patches: champion.patches, reason: champion.reason } : undefined,
      parentPool: parentPool.slice(0, 8).map((item) => ({ source: item.source, id: item.id, label: item.label, round: item.round, score: item.score, niche: item.niche, patches: item.patches, reason: item.reason })),
      recentArchive: archive.slice(-12).map((entry) => ({ id: entry.id, round: entry.round, kind: entry.kind, niche: entry.niche, score: entry.score, candidateId: entry.candidate.id, patches: entry.candidate.patches, reason: entry.reason })),
      instruction: champion ? "所有 Candidate 都以当前已验收 Search Champion 为执行基底；parentPool/Archive 只提供交叉、复用和探索的遗传材料，禁止退回最初原版重新独立优化。" : "首轮从原始 Target 开始；建立第一个可验证 Search Champion。",
    },
    project: { aiProfile: project.aiProfile, goal: project.goal, evolutionCommand: project.evolutionCommand,
      protectedItems: project.protectedItems, editableItems: project.editableItems,
      inputClarifications: project.inputClarifications,
      inputUnderstanding: project.inputUnderstanding ? { intentRestatement: project.inputUnderstanding.intentRestatement,
        acceptanceFocus: project.inputUnderstanding.acceptanceFocus } : undefined,
      sourceArtifacts: context.sources },
    diagnosis: project.diagnosis,
    ...planGroundingContext(project, task.problem?.id),
    candidateCount: task.candidateCount,
    task: { title: task.title, scope: task.scope, mode: task.mode, problemId: task.problem?.id,
      evidence: task.problem?.evidence, contextCoverage: { budget: context.budget, usedChars: context.usedChars, totalArtifacts: context.totalArtifacts, omittedArtifactIds: context.omittedArtifactIds, limitation: context.limitation },
      instructions: "本轮只解决选中的问题。修改须引用真实原文或文件路径；用局部补丁保留其他内容。保护约束全部生效，但不要求本轮解决其他目标。跨模块修改须解释依赖与关联回归检查。信息不足时不得编造原文。" },
    existingLessons: project.lessons.slice(-6),
  };
}
