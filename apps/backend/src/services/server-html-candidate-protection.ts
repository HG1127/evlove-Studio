import type { EvolveProject, SourceArtifact } from "@evolution/contracts";
import { CandidateConstructionOutputError } from "@evolution/harness";
import { htmlCandidateProtection, requiresHtmlProtectionBaseline } from "@evolution/core";

/** Compose physical file reads with pure protection policy before any Candidate writes. */
export async function checkServerHtmlCandidateProtection(args: {
  project: EvolveProject; source: SourceArtifact; candidateContent: string; parentText: string;
  hasParent: boolean; readOriginal: () => Promise<string>;
}) {
  if (!/^(html|htm)$/i.test(args.source.extension) && !/^text\/html(?:;|$)/i.test(args.source.mimeType)) return { checks: [], limitations: [] };
  const protectedItems = args.project.protectedItems ?? [];
  const inputs = [args.parentText];
  if (args.hasParent && requiresHtmlProtectionBaseline(protectedItems)) {
    const original = await args.readOriginal();
    if (original !== args.parentText) inputs.push(original);
  }
  const reports = inputs.map((originalHtml) => htmlCandidateProtection({
    sourceArtifactId: args.source.id, originalHtml, candidateHtml: args.candidateContent,
    protectedItems,
  }));
  const issues = [...new Set(reports.flatMap((report) => report.issues))];
  if (issues.length) throw new CandidateConstructionOutputError("html-protection", args.source.name + " HTML 候选前置检查失败：" + issues.join("；"));
  const unresolved = [...new Set(reports.flatMap((report) => report.unresolvedProtectedIds))];
  return {
    checks: ["HTML 保护前置检查：完整父代文件无新增重复 ID；可定位的显式章节保护已逐项核对",
      ...reports.filter((report) => report.originalSlideCount > 0).map((report) => "HTML 保护：保留实际原文件的 " + report.originalSlideCount + " 个 slide-card ID")],
    limitations: ["HTML 保护前置检查仅核对显式章节、标题、原文和标签序列；交互、语义与视觉质量仍需独立验收",
      ...(unresolved.length ? ["原文件中不存在的保护章节无法提供确认：" + unresolved.join("、")] : [])],
  };
}
