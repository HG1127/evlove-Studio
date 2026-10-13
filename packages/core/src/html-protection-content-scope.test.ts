import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema } from "@evolution/contracts";
import { htmlProtectionContentScope } from "./html-protection-content-scope";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionObligationPlan } from "./html-protection-obligation-plan";
const protect = AcceptanceCriterionSchema.parse({ id: "PROTECT-ALL", title: "保护", requirement: "保留核心方法、章节结构、CSS样式与HTML交互", hardGate: true, protectedConstraint: true, artifactIds: ["S1"] });
const details = AcceptanceCriterionSchema.parse({ id: "AC-REFINE-DETAIL", title: "配置细节", requirement: "各章节配置细节得到有效细化，包括参数说明更完整、步骤分解更细致、配置项补充更全面", hardGate: true, artifactIds: ["S1"] });
const clarity = AcceptanceCriterionSchema.parse({ id: "AC-UNDERSTANDABILITY", title: "小白理解", requirement: "内容更易于小白理解：概念解释更直白、示例更贴近实际、术语有适当解释、避免过于专业的表述", validationMethod: "user-scenario", hardGate: true, artifactIds: ["S1"] });
const scope = (rubric = [protect, details, clarity]) => htmlProtectionContentScope({ sourceArtifactId: "S1", frozenContract: { protectionCriterionId: protect.id, rubric } });
const original = htmlProtectionInventory({ sourceArtifactId: "S1", html: '<!doctype html><html><head><style>.slide-card{display:block}</style></head><body><p>Outside method</p><article class="slide-card" id="card"><h2>Original heading</h2><p>Original method</p></article><script>const original=true;</script></body></html>' });

describe("frozen content refinement evidence scope", () => {
  it("uses actual positive detail and understandability requirements without imposing verbatim text", () => {
    const result = scope();
    expect(result.mode).toBe("semantic-refinement");
    expect(result.refinementCriterionIds).toEqual([details.id, clarity.id]);
    expect(result.gaps).toEqual([]);
    for (const key of ["authorized", "passed", "complete", "proof", "evidence"]) expect(result).not.toHaveProperty(key);
  });
  it("retains every Original content obligation, including outside cards, as unresolved independent semantic evidence", () => {
    const frozenContentContract = { protectionCriterionId: protect.id, rubric: [protect, details, clarity] };
    const before = structuredClone(frozenContentContract);
    const result = htmlProtectionObligationPlan({ originalInventory: original, frozenContentContract });
    expect(frozenContentContract).toEqual(before);
    const card = result.scope.cards[0]!;
    const content = result.requiredObligations.find(item => item.id === card.contentObligationId)!;
    expect(content).toMatchObject({ kind: "card-content", evidenceKind: "semantic", support: "unresolved" });
    expect(card.staticObligationIds).not.toContain(content.id);
    expect(card.staticObligationIds).toHaveLength(3);
    expect(result.requiredObligations.find(item => item.id === result.scope.document.content))
      .toMatchObject({ kind: "core-method", evidenceKind: "semantic", support: "unresolved" });
    expect(result.originalInventory).toEqual(original);
    expect(result.requiredObligations).toHaveLength(htmlProtectionObligationPlan({ originalInventory: original }).requiredObligations.length);
    expect(result.requiredObligations.filter(item => item.kind === "unknown-runtime").every(item => item.support === "unresolved")).toBe(true);
    expect([...result.scope.styles, ...result.scope.scripts].every(id => result.requiredObligations.find(item => item.id === id)?.evidenceKind === "static")).toBe(true);
  });
  it("keeps the compatibility default literal and never treats readability as removal or structure permission", () => {
    const result = htmlProtectionObligationPlan({ originalInventory: original });
    const card = result.scope.cards[0]!;
    expect(card.staticObligationIds).toContain(card.contentObligationId);
    expect(result.contentScope).toBeNull();
    expect(scope([protect]).mode).toBe("literal-retention");
  });
  it.each(["不能只增加解释、测试话术或包装文字。", "不要补充配置说明。", "无需细化章节。", "避免增加示例内容。", "章节配置细节不需要细化。", "configuration refinement is not required."])("does not infer refinement from negated instruction %s", requirement => {
    expect(scope([protect, { ...details, requirement }]).mode).toBe("literal-retention");
  });
  it.each(["foreign", "non-hard", "protected", "model-source", "static-route"])("ignores %s as content refinement", kind => {
    const changed = { ...details };
    if (kind === "foreign") changed.artifactIds = ["other"];
    if (kind === "non-hard") changed.hardGate = false;
    if (kind === "protected") changed.protectedConstraint = true;
    if (kind === "model-source") changed.source = "source-understanding";
    if (kind === "static-route") changed.validationMethod = "static-structure";
    expect(scope([protect, changed]).mode).toBe("literal-retention");
  });
  it.each(["正文逐字保持不变", "不得修改原文", "Preserve the content verbatim", "每章原有配置参数与命令必须保持原样，禁止更改其字符；只可在原章末尾新增解释", "正文不得有任何删改"])("retains conflict instead of relaxing explicit literal protection: %s", requirement => {
    const result = scope([{ ...protect, requirement }, details]);
    expect(result.mode).toBe("literal-retention");
    expect(result.gaps).toEqual(["conflicting-literal-and-refinement-contract"]);
    const plan = htmlProtectionObligationPlan({ originalInventory: original, frozenContentContract: { protectionCriterionId: protect.id, rubric: [{ ...protect, requirement }, details] } });
    expect(plan.gaps.some(item => item.code === "conflicting-literal-and-refinement-contract")).toBe(true);
  });
  it.each(["duplicate", "foreign-protection", "soft-protection", "unprotected", "empty", "duplicate-scope"])("rejects %s stored criterion", kind => {
    const rubric = [structuredClone(protect), structuredClone(details)];
    if (kind === "duplicate") rubric.push(rubric[0]!);
    if (kind === "foreign-protection") rubric[0]!.artifactIds = ["other"];
    if (kind === "soft-protection") rubric[0]!.hardGate = false;
    if (kind === "unprotected") rubric[0]!.protectedConstraint = false;
    if (kind === "empty") rubric[1]!.requirement = "";
    if (kind === "duplicate-scope") rubric[0]!.artifactIds = ["S1", "S1"];
    expect(() => scope(rubric)).toThrow();
  });
  it("keeps unfamiliar protected editing restrictions unresolved instead of treating them as permission", () => {
    const result = scope([{ ...protect, requirement: "禁止调整原有配置参数" }, details]);
    expect(result.mode).toBe("literal-retention");
    expect(result.gaps).toContain("content-restriction-needs-independent-interpretation");
  });
  it("rejects Candidate/AI authorization material rather than using it as a frozen contract", () => {
    expect(() => htmlProtectionContentScope({ sourceArtifactId: "S1", frozenContract: { protectionCriterionId: protect.id, rubric: [protect, details], authorized: true } } as Parameters<typeof htmlProtectionContentScope>[0])).toThrow();
  });
});
