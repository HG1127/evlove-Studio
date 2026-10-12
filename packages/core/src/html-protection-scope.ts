import type { AcceptanceCriterion, EvolveProject } from "@evolution/contracts";
import { htmlProtectionContractBlocker } from "./html-protection-browser-steps";

export type HtmlProtectionEvaluationScope = Pick<EvolveProject, "sourceArtifacts">;
export const HTML_PROTECTION_SETTLEMENT_POLICY = "html-whole-scope-required-v1";
export const HTML_PROTECTION_SCOPE_GAP =
  "[html-protection-scope-pending] 完整 HTML 保护标准尚缺独立、绑定原始文件与当前快照及考卷的全量执行证据；搜索断言、静态索引、格式往返或模型声明不能替代完整保护。";

/** The acceptance contract, rather than editable test tags or routing methods, owns scope. */
export function isWholeProtectionCriterion(criterion: AcceptanceCriterion): boolean {
  if (criterion.id === "PROTECT-ALL" || criterion.id === "SYS-INTEGRITY") return true;
  const text = [criterion.title, criterion.requirement, ...(criterion.evidenceExpected ?? [])].join(" ");
  const whole = /(?:全部|所有|完整|整体|原有|原始|现有|全量|\ball\b|\bfull\b|\bcomplete\b|\bentire\b|\bwhole\b|\boriginal\b|\bexisting\b)/i;
  const preservation = /(?:保留|保护|不变|保持|不受损|不得丢失|不能.*丢失|未授权|完整性|\bkeep\b|\bmaintain\w*\b|\bpreserv\w*\b|\bretain\w*\b|\bprotect\w*\b|\bunchanged\b|\bintegrity\b|\bno.*loss\b)/i;
  // A full preservation declaration wins over a renamed format route.
  if (/(?:全部|所有|全量|整体|完整|\ball\b|\bfull\b|\bcomplete\b|\bentire\b|\bwhole\b)/i.test(text)
    && preservation.test(text)) return true;
  // A positive vocabulary admits actual format-only contracts. Unknown words
  // remain in scope; a finite blacklist must not exempt output/payload preservation.
  const formatVocabulary = /(?:完全一致|保持|保留|确认|检查|支持|文件|原始|原有|当前|目标|原|格式|往返|编码|逐字|一致|不变|必须|可|能|与|和|\b(?:format|file|original|current|roundtrip|encoding|same|exact|reversible|preserved|preserve|retain|unchanged|must|remain|be|pass|only|and|markdown|html|text|txt|csv|json|yaml|utf-?8)\b)/ig;
  const formatContractText = [criterion.requirement, ...(criterion.evidenceExpected ?? [])].join(" ");
  const titleDeclaresPreservation = whole.test(criterion.title ?? "") && preservation.test(criterion.title ?? "");
  const formatOnly = criterion.validationMethod === "format-roundtrip"
    && criterion.source !== "protected-item" && criterion.category !== "protected"
    && /(?:格式|往返|编码|\bformat\b|\broundtrip\b|\bencoding\b|\bmarkdown\b)/i.test(criterion.requirement ?? "")
    && !titleDeclaresPreservation
    && formatContractText.replace(formatVocabulary, "").replace(/[\s\p{P}\p{S}]/gu, "").length === 0;
  if (formatOnly) return false;
  if (criterion.source === "protected-item" || criterion.protectedConstraint || criterion.category === "protected") return true;
  return whole.test(text) && preservation.test(text)
    || criterion.validationMethod !== "format-roundtrip" && (criterion.category === "integrity" || criterion.judgeType === "integrity");
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
  const knownNonHtmlExtension = /^(txt|md|markdown|mdx|csv|tsv|json|yaml|yml|xml|pdf|docx?|odt|rtf|xlsx?|ods|pptx?|odp|png|jpe?g|gif|webp|svg|bmp|ico|zip|tar|gz|js|jsx|ts|tsx|css|py|java|c|cpp|h|rs|go|sh|ps1)$/i;
  const knownNonHtmlMime = /^(?:image\/(?:png|jpeg|gif|webp|svg\+xml|bmp|x-icon)|text\/(?:plain|markdown|csv|tab-separated-values|css)|application\/(?:json|pdf|zip|gzip|xml|msword|vnd\.(?:openxmlformats-officedocument\.[a-z.]+|ms-excel|ms-powerpoint|oasis\.opendocument\.[a-z.]+)))(?:;|$)/i;
  if (targets.some(artifact => !knownNonHtmlExtension.test(artifact.extension)
    && !knownNonHtmlMime.test(artifact.mimeType))) return undefined;
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
  if (hasHtmlProtectionTarget(project) === false) return undefined;
  return project.acceptanceRubric.some(isWholeProtectionCriterion) ? HTML_PROTECTION_SCOPE_GAP : undefined;
}
