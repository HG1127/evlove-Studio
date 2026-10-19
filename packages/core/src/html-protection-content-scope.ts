import { HtmlProtectionOperationalScopeSchema, type HtmlProtectionOperationalScope, AcceptanceCriterionSchema, type AcceptanceCriterion } from "@evolution/contracts";

export type HtmlProtectionFrozenContentContract = {
  operationalScope?: HtmlProtectionOperationalScope;
  protectionCriterionId: string;
  rubric: readonly AcceptanceCriterion[];
};
const literalRequirement = /(?:逐字|逐句|原样|删改|更改其字符|禁止更改|原文(?:内容|文字)?(?:必须|应当|须)?(?:保持)?(?:不变|一致)|(?:正文|文本|文字|内容).{0,12}(?:字节级|逐字|完全一致)|(?:不得|禁止|不能).{0,6}(?:改写|修改|重写)(?:原文|正文|文本|文字)|\b(?:verbatim|byte.identical|character.for.character|unmodified|unedited)\b)/i;
const content = /(?:正文|原文|文本|文字|内容|概念|术语|说明|解释|配置|参数|步骤|章节|示例|\b(?:content|text|wording|explanation|terminology|configuration|parameter|steps|chapters|examples)\b)/i;
const refine = /(?:细化|细致|细节|更完整|更全面|更直白|更易.{0,8}理解|更贴近实际|适当解释|补充|\b(?:refine|clarify|elaborate|expand|more detailed|easier to understand)\b)/i;
const negated = /(?:不得|禁止|不能|不允许|不需要|不要求|没有必要|无需|不应|不要|避免|\b(?:must not|do not|cannot|not required|without)\b)/i;

/** Compile evidence requirements from the stored rubric. This never grants modification or acceptance authority. */
export function htmlProtectionContentScope(args: {
  sourceArtifactId: string;
  frozenContract: HtmlProtectionFrozenContentContract;
}) {
  if (!args || Object.keys(args).some(key => !["sourceArtifactId", "frozenContract"].includes(key))
    || typeof args.sourceArtifactId !== "string" || !args.sourceArtifactId.trim()) throw Error("Invalid content scope inputs");
  const frozen = args.frozenContract;
  if (!frozen || Object.keys(frozen).some(key => !["protectionCriterionId", "rubric", "operationalScope"].includes(key))
    || typeof frozen.protectionCriterionId !== "string" || !Array.isArray(frozen.rubric) || !frozen.rubric.length) {
    throw Error("Complete stored protection rubric required");
  }
  const rubric = frozen.rubric.map(item => AcceptanceCriterionSchema.parse(item));
  if (rubric.some(item => !item.id.trim() || !item.requirement.trim()
    || new Set(item.artifactIds).size !== item.artifactIds.length)
    || new Set(rubric.map(item => item.id)).size !== rubric.length) throw Error("Ambiguous stored content criterion");
  const relevant = rubric.filter(item => !item.artifactIds.length || item.artifactIds.includes(args.sourceArtifactId));
  const protection = relevant.find(item => item.id === frozen.protectionCriterionId);
  if (!protection?.hardGate || !protection.protectedConstraint) throw Error("Unique source-scoped protected hard criterion required");
  const literalCriteria = relevant.filter(item => item.hardGate && literalRequirement.test(item.requirement));
  const refinementCriteria = relevant.filter(item => item.hardGate && !item.protectedConstraint
    && item.source === "user-command" && ["user-scenario", "semantic-judge"].includes(item.validationMethod)
    && item.requirement.split(/[。；;，,:：\n]/).some(clause => content.test(clause) && refine.test(clause) && !negated.test(clause)));
  const ambiguousRestrictions = relevant.filter(item => item.hardGate && item.protectedConstraint
    && content.test(item.requirement) && negated.test(item.requirement)
    && /(?:修改|改写|重写|更改|调整|删除|替换|\b(?:alter|modify|change|edit|rewrite|delete|replace)\b)/i.test(item.requirement)
    && !literalRequirement.test(item.requirement));
  const operationalScope = frozen.operationalScope ? HtmlProtectionOperationalScopeSchema.parse(frozen.operationalScope) : undefined;
  if (operationalScope && operationalScope.original.sourceArtifactId !== args.sourceArtifactId) throw Error("operational-scope-content-source-foreign");
  const conflict = (literalCriteria.length > 0 || ambiguousRestrictions.length > 0) && refinementCriteria.length > 0;
  return {
    schemaVersion: "html-protection-content-scope-v1" as const,
    ...(operationalScope ? { operationalScope } : {}),
    sourceArtifactId: args.sourceArtifactId,
    protectionCriterionId: protection.id,
    mode: operationalScope && !literalCriteria.length ? "semantic-refinement" as const : !conflict && !ambiguousRestrictions.length && refinementCriteria.length ? "semantic-refinement" as const : "literal-retention" as const,
    refinementCriterionIds: refinementCriteria.map(item => item.id),
    literalCriterionIds: literalCriteria.map(item => item.id),
    ambiguousRestrictionCriterionIds: ambiguousRestrictions.map(item => item.id),
    gaps: operationalScope ? (literalCriteria.length ? ["conflicting-operational-and-literal-contract"] : []) : [...(conflict ? ["conflicting-literal-and-refinement-contract"] : []),
      ...(ambiguousRestrictions.length ? ["content-restriction-needs-independent-interpretation"] : [])],
    limitations: [
      "A stored rubric-shaped DTO does not authenticate the frozen paper; the app must bind its exact paper hash.",
      "Refinement requires independent coverage of all Original content and method meaning, including content outside cards.",
      "Static differences remain facts; semantic evaluation must decide whether declared refinement retains Original meaning.",
      "This scope changes neither headings, styles, scripts, runtime requirements nor the frozen rubric, and supplies no PASS.",
    ],
  };
}
