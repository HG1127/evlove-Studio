import type { EvolveProject } from "@evolution/contracts";
import { describeArtifact } from "./artifact-strategy";

/** Shared by manual approval and automatic execution; no silent AI assumptions. */
export function goalReadiness(project: EvolveProject) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const targets = project.sourceArtifacts.filter((a) => a.role === "target");
  if (!targets.length) blockers.push("请加入至少一份要修改的当前成果。");
  if (!project.goal?.trim()) blockers.push("请说明希望改善的目标。");
  for (const source of targets) {
    if(source.textContent?.includes("[...truncated by Evolve Studio...]")||source.warnings.some(w=>/Studio 已截断进入|进入 AI 上下文的部分已截断/.test(w))) blockers.push(`${source.name} 保留的是旧版截断记录，请在材料页重新深度解析原文件。`);
    const descriptor = source.artifactDescriptor ?? describeArtifact(source);
    if (["error", "binary", "unsupported"].includes(source.parseStatus)) blockers.push(`${source.name} 尚未可靠读取，请重新上传可解析版本。`);
    if (!descriptor.capabilities.materialize || ["rtf","odt","odp","doc","ppt"].includes(source.extension.toLowerCase())) blockers.push(`${source.name} 暂无原格式生成能力，请转换为可编辑格式或接入对应生成器。`);
    warnings.push(...descriptor.limitations.map((text) => `${source.name}：${text}`));
    warnings.push(...source.warnings.map((text) => `${source.name}：${text}`));
  }
  if (project.inputUnderstanding?.status !== "ready") blockers.push("请先完成材料与意图理解，再确认目标。");
  const questions = (project.inputUnderstanding?.clarifications ?? []).filter((q) => !project.inputClarifications.some((a) => a.question === q.question && a.answer.trim()));
  if (questions.length) blockers.push(`还有 ${questions.length} 个会影响方向的问题需要确认，可回答或明确采用建议。`);
  return { ready: blockers.length === 0, blockers, warnings: [...new Set(warnings)], questions };
}
