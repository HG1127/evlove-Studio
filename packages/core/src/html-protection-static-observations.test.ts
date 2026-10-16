import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema, HtmlProtectionSemanticFrozenRequirementsSchema, TestCaseSchema } from "@evolution/contracts";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionObligationPlan } from "./html-protection-obligation-plan";
import { deriveHtmlProtectionStaticObservations, deriveHtmlProtectionSemanticRequirementScopes, supportHtmlProtectionObservedObligations } from "./html-protection-static-observations";
const card = (id: string, text = "Original meaning") => '<article class="slide-card" id="' + id + '"><h2>Title</h2><p>' + text + '</p></article>';
const wrap = (body: string) => '<!doctype html><html><head><style>p{color:red}</style><script>let value=1</script></head><body>' + body + '</body></html>';
function fixture() { const originalHtml = wrap(card("one") + card("two")); return { originalHtml, plan: htmlProtectionObligationPlan({ originalInventory: htmlProtectionInventory({ sourceArtifactId: "source", html: originalHtml }) }) }; }
describe("complete physical static observations", () => {
  it("compares complete source facts without discharging semantic/visual/runtime obligations", () => {
    const f = fixture(), result = deriveHtmlProtectionStaticObservations({ ...f, executedHtml: f.originalHtml });
    expect(result.staticFacts.every(item => item.verificationStatus === "verified")).toBe(true);
    expect(result.supportedObligationIds.every(id => f.plan.requiredObligations.find(item => item.id === id)?.evidenceKind === "static")).toBe(true);
  });
  it.each(["last-card", "title", "css", "script", "attribute", "added-card"] as const)("retains actual %s changes", kind => {
    const f = fixture(); let executedHtml = f.originalHtml;
    if (kind === "last-card") executedHtml = wrap(card("one"));
    if (kind === "title") executedHtml = executedHtml.replace("<h2>Title</h2>","<h2>Lost original</h2>");
    if (kind === "css") executedHtml = executedHtml.replace("color:red","color:blue");
    if (kind === "script") executedHtml = executedHtml.replace("value=1","value=2");
    if (kind === "attribute") executedHtml = executedHtml.replace('id="one"','id="one" title="modified"');
    if (kind === "added-card") executedHtml = executedHtml.replace("</body>",card("new")+"</body>");
    expect(deriveHtmlProtectionStaticObservations({ ...f, executedHtml }).staticFacts.some(item => item.verificationStatus === "failed")).toBe(true);
  });
  it("retains known losses even when additional unknown/duplicate scope exists", () => {
    const f = fixture(), executedHtml = wrap(card("one") + card("one") + card("new"));
    const facts = deriveHtmlProtectionStaticObservations({ ...f, executedHtml }).staticFacts;
    expect(facts.filter(item => f.plan.scope.cards[1]!.staticObligationIds.includes(item.obligationId)).every(item => item.verificationStatus === "failed")).toBe(true);
  });
  it("refuses a mismatching Original inventory and foreign/duplicate supported scope", () => {
    const f = fixture(); expect(() => deriveHtmlProtectionStaticObservations({ ...f, originalHtml: wrap(card("other")), executedHtml: f.originalHtml })).toThrow();
    expect(() => supportHtmlProtectionObservedObligations(f.plan.requiredObligations,["foreign"])).toThrow();
    const id = f.plan.requiredObligations[0]!.id; expect(() => supportHtmlProtectionObservedObligations(f.plan.requiredObligations,[id,id])).toThrow();
    const unknown = f.plan.scope.document.runtimeResidual;
    expect(supportHtmlProtectionObservedObligations(f.plan.requiredObligations,[unknown]).find(item => item.id===unknown)?.support).toBe("unresolved");
  });
});

describe("Original-only explicit frozen semantic regions",()=>{
  function scoped(requirement="Refine body text of card #one",editableItems=["Only body text of card #one"]) {
    const rubric=[AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Whole protection",requirement:"Preserve all Original content and methods",hardGate:true,protectedConstraint:true,artifactIds:["source"]}),
      AcceptanceCriterionSchema.parse({id:"REFINE",title:"Narrow refinement",requirement,source:"user-command",hardGate:true,validationMethod:"semantic-judge",artifactIds:["source"]})];
    const testCase=TestCaseSchema.parse({id:"H",title:"Frozen case",input:"Full Original",expected:["Original retention"],hidden:true,criterionIds:["PROTECT-ALL","REFINE"]});
    const frozenRequirements=HtmlProtectionSemanticFrozenRequirementsSchema.parse({schemaVersion:"html-protection-semantic-frozen-requirements-v1",missionId:"M",sourceArtifactId:"source",criterionId:"PROTECT-ALL",paperSha256:"1".repeat(64),
      testCase,paper:[testCase],rubric,goal:"Retain Original",evolutionCommand:requirement,protectedItems:["Original method meaning"],editableItems});
    const originalHtml=wrap('<p>Outside original</p>'+card("one","Alpha method")+card("two","Beta method"));
    const plan=htmlProtectionObligationPlan({originalInventory:htmlProtectionInventory({sourceArtifactId:"source",html:originalHtml}),frozenContentContract:{protectionCriterionId:"PROTECT-ALL",rubric}});
    return {plan,frozenRequirements,originalHtml};
  }
  it("retains all Original text nodes except the explicitly editable A body; a source-wide refinement route does not grant B permission",()=>{
    const f=scoped();expect(f.plan.contentScope?.mode).toBe("semantic-refinement");
    const result=deriveHtmlProtectionSemanticRequirementScopes({...f,executedHtml:f.originalHtml.replace("Alpha method","Alpha method with detail")});
    expect(result.gaps).toEqual([]);expect(result.editableCardIds).toEqual(["one"]);expect(result.scopes.every(item=>item.verificationStatus==="verified")).toBe(true);
    expect(result.scopes.find(item=>item.obligationId===f.plan.scope.cards[1]!.contentObligationId)?.mode).toBe("literal-retention");
    const wrong=deriveHtmlProtectionSemanticRequirementScopes({...f,executedHtml:f.originalHtml.replace("Beta method","Equivalent Beta wording")});
    expect(wrong.scopes.find(item=>item.obligationId===f.plan.scope.cards[1]!.contentObligationId)?.verificationStatus).toBe("failed");
    expect(wrong.scopes.find(item=>item.obligationId===f.plan.scope.document.content)?.verificationStatus).toBe("failed");
  });
  it.each(["outside","heading","script","comment"] as const)("does not use A body permission to change %s",kind=>{
    const f=scoped();let executedHtml=f.originalHtml;
    if(kind==="outside")executedHtml=executedHtml.replace("Outside original","Outside rewritten");
    if(kind==="heading")executedHtml=executedHtml.replace("<h2>Title</h2>","<h2>Other title</h2>");
    if(kind==="script")executedHtml=executedHtml.replace("value=1","value=2");
    if(kind==="comment")executedHtml=executedHtml.replace("</body>","<!--new unsupported content--></body>");
    const result=deriveHtmlProtectionSemanticRequirementScopes({...f,executedHtml});
    expect(result.scopes.find(item=>item.obligationId===f.plan.scope.document.semantic)?.verificationStatus).toBe("failed");
  });
  it.each(["Refine body text of introductory card","Refine body text of card #absent","Refine all body text except card #two"])("leaves unknown semantic permission unresolved: %s",requirement=>{
    const f=scoped(requirement,["Only body text of card #one"]),result=deriveHtmlProtectionSemanticRequirementScopes({...f,executedHtml:f.originalHtml.replace("Beta method","Equivalent Beta wording")});
    expect(result.gaps.length).toBeGreaterThan(0);expect(result.scopes.every(item=>item.verificationStatus==="unverified")).toBe(true);
  });
  it("intersects explicit rubric permission with actual editableItems and explicit protected regions",()=>{
    const f=scoped("Refine all card body text",["Only body text of card #one"]);
    f.frozenRequirements.protectedItems=["card #one"];
    const result=deriveHtmlProtectionSemanticRequirementScopes({...f,executedHtml:f.originalHtml.replace("Alpha method","Alpha method with detail")});
    expect(result.editableCardIds).toEqual([]);expect(result.scopes.find(item=>item.obligationId===f.plan.scope.cards[0]!.contentObligationId)?.verificationStatus).toBe("failed");
  });
  it("rejects a same-ID changed frozen case or content-plan/rubric mismatch",()=>{
    const f=scoped();f.frozenRequirements.testCase.input+="changed";
    expect(()=>deriveHtmlProtectionSemanticRequirementScopes({...f,executedHtml:f.originalHtml})).toThrow("frozen-paper-scope-invalid");
    f.frozenRequirements.testCase=f.frozenRequirements.paper[0]!;f.frozenRequirements.rubric[1]!.requirement="Keep all text verbatim";
    expect(()=>deriveHtmlProtectionSemanticRequirementScopes({...f,executedHtml:f.originalHtml})).toThrow("frozen-content-plan-drift");
  });
});
