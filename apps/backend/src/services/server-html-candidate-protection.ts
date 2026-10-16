import { createHash } from "node:crypto";
import { HtmlProtectionSemanticFrozenRequirementsSchema, type EvolveProject, type SourceArtifact } from "@evolution/contracts";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
import { CandidateConstructionOutputError } from "@evolution/harness";
import { confirmedHtmlProtectionOperationalScope, htmlProtectionInventory, htmlProtectionObligationPlan, deriveHtmlProtectionStaticObservations, deriveHtmlProtectionSemanticRequirementScopes, htmlCandidateProtection, requiresHtmlProtectionBaseline } from "@evolution/core";

/** Compose physical file reads with pure protection policy before any Candidate writes. */
export async function checkServerHtmlCandidateProtection(args: {
  project: EvolveProject; source: SourceArtifact; candidateContent: string; parentText: string;
  hasParent: boolean; readOriginal: () => Promise<string>;
}) {
  if (!/^(html|htm)$/i.test(args.source.extension) && !/^text\/html(?:;|$)/i.test(args.source.mimeType)) return { checks: [], limitations: [] };
  if (args.project.htmlProtectionOperationalScope) return checkOperationalCandidate(args);
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

async function checkOperationalCandidate(args: Parameters<typeof checkServerHtmlCandidateProtection>[0]) {
  const {project,source}=args, originalHtml=await args.readOriginal(), bytes=Buffer.from(originalHtml,"utf8");
  const digest=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
  const scope=confirmedHtmlProtectionOperationalScope(project,{sourceArtifactId:source.id,sha256:digest(originalHtml),byteLength:bytes.byteLength});
  if(!scope)throw Error("operational-candidate-confirmation-missing");
  const criterion=project.acceptanceRubric.find(item=>item.hardGate&&item.protectedConstraint&&(!item.artifactIds.length||item.artifactIds.includes(source.id)));
  const testCase=[...project.evalSuite,...project.hiddenEvalSuite].find(test=>criterion&&test.criterionIds.includes(criterion.id));
  if(!criterion||!testCase)throw Error("operational-candidate-protected-paper-missing");
  const paper=testCase.hidden?project.hiddenEvalSuite:project.evalSuite;
  const frozenRequirements=HtmlProtectionSemanticFrozenRequirementsSchema.parse({schemaVersion:"html-protection-semantic-frozen-requirements-v1",
    missionId:project.id,sourceArtifactId:source.id,criterionId:criterion.id,paperSha256:digest(htmlProtectionCanonicalJson({version:"html-protection-paper-v1",paper,rubric:project.acceptanceRubric,protectedItems:project.protectedItems,operationalScope:scope})),
    testCase,paper,rubric:project.acceptanceRubric,goal:project.goal,evolutionCommand:project.evolutionCommand,
    protectedItems:project.protectedItems,editableItems:project.editableItems,operationalScope:scope});
  const plan=htmlProtectionObligationPlan({originalInventory:htmlProtectionInventory({sourceArtifactId:source.id,html:originalHtml}),
    frozenContentContract:{protectionCriterionId:criterion.id,rubric:project.acceptanceRubric,operationalScope:scope}});
  const statics=deriveHtmlProtectionStaticObservations({plan,originalHtml,executedHtml:args.candidateContent});
  const boundaries=deriveHtmlProtectionSemanticRequirementScopes({plan,frozenRequirements,originalHtml,executedHtml:args.candidateContent});
  // This is a construction boundary check, never semantic preservation, native runtime, Gate F or acceptance evidence.
  if(statics.staticFacts.some(item=>item.verificationStatus!=="verified")||boundaries.gaps.length||boundaries.scopes.some(item=>item.verificationStatus!=="verified"))
    throw new CandidateConstructionOutputError("html-protection",source.name+" Candidate 超出已确认的现有章节正文文字修改范围；禁止冻结该文件。");
  return {checks:["人工确认范围前置检查：完整 Original 的 "+plan.scope.cards.length+" 张卡片及全部静态来源保留；仅现有章节正文文字节点可改动"],
    limitations:["前置检查只验证物理编辑边界；全部方法含义、登记控件及状态、视口视觉仍须独立验收；范围外行为未验证。"]};
}
