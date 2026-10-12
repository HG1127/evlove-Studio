import type { AcceptanceCriterion, EvolveProject } from "@evolution/contracts";
import { htmlProtectionContractBlocker } from "./html-protection-browser-steps";

export type HtmlProtectionEvaluationScope = Pick<EvolveProject, "sourceArtifacts">;
export const HTML_PROTECTION_SETTLEMENT_POLICY = "html-whole-scope-required-v1";
export const HTML_PROTECTION_SCOPE_GAP =
  "[html-protection-scope-pending] 完整 HTML 保护标准尚缺独立、绑定原始文件与当前快照及考卷的全量执行证据；搜索断言、静态索引、格式往返或模型声明不能替代完整保护。";

/** The acceptance contract, rather than editable test tags or routing methods, owns scope. */
export function isWholeProtectionCriterion(criterion: AcceptanceCriterion): boolean {
  if (criterion.id === "PROTECT-ALL" || criterion.id === "SYS-INTEGRITY") return true;
  if (criterion.source === "protected-item" || criterion.protectedConstraint) return true;
  const text = [criterion.title, criterion.requirement, ...criterion.evidenceExpected].join(" ");
  const whole = /(?:全部|所有|完整|整体|原有|原始|现有|全量|\ball\b|\bentire\b|\bwhole\b|\boriginal\b|\bexisting\b)/i;
  const preservation = /(?:保留|保护|不变|保持|不受损|不得丢失|不能.*丢失|未授权|完整性|\bpreserv\w*\b|\bretain\w*\b|\bprotect\w*\b|\bunchanged\b|\bintegrity\b|\bno.*loss\b)/i;
  return whole.test(text) && preservation.test(text);
}

/** Unknown scope fails closed; known non-HTML targets retain their existing evidence policy. */
export function hasHtmlProtectionTarget(scope?: HtmlProtectionEvaluationScope): boolean | undefined {
  if (!scope) return undefined;
  const targets = scope.sourceArtifacts.filter(artifact => artifact.role === "target");
  if (!targets.length) return undefined;
  if (targets.some(artifact => /^(html|htm)$/i.test(artifact.extension)
    || /\.html?$/i.test(artifact.name)
    || /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(artifact.mimeType)
    || /<!doctype\s+html\b|<(?:html|body|script)\b/i.test(artifact.textContent ?? ""))) return true;
  if (targets.some(artifact => !artifact.extension && artifact.mimeType === "application/octet-stream")) return undefined;
  return false;
}

/**
 * No production collector currently supplies independent complete-scope authority.
 * Never derive authority from TargetRunResult.htmlProtectionProof, AI prose or tags.
 * Future authority wiring must independently validate original bytes, the full
 * obligation set, paper/subject identity and attested observations before changing this ceiling.
 */
export function htmlProtectionCoverageGap(
  criterion: AcceptanceCriterion, scope?: HtmlProtectionEvaluationScope,
): string | undefined {
  return isWholeProtectionCriterion(criterion) && hasHtmlProtectionTarget(scope) !== false
    ? HTML_PROTECTION_SCOPE_GAP : undefined;
}

/** Acceptance/delivery guard, separate from execution preflight so evidence can still be collected. */
export function htmlProtectionAcceptanceBlocker(project: EvolveProject): string | undefined {
  const paperGap = htmlProtectionContractBlocker(project);
  if (paperGap) return paperGap;
  if (hasHtmlProtectionTarget(project) !== true) return undefined;
  return project.acceptanceRubric.some(isWholeProtectionCriterion) ? HTML_PROTECTION_SCOPE_GAP : undefined;
}
