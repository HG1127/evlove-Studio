// @vitest-environment node
import {createHash} from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { htmlProtectionInventory, htmlProtectionObligationPlan } from "@evolution/core";
import { AcceptanceCriterionSchema, HtmlProtectionSemanticFrozenRequirementsSchema, TestCaseSchema, type HtmlProtectionSemanticObservations } from "@evolution/contracts";
import { collectServerHtmlProtectionSemanticObservations, prepareServerHtmlProtectionSemanticComponents, validateServerHtmlProtectionSemanticObservations, prepareServerHtmlProtectionSemanticSegments, prepareServerHtmlProtectionSemanticCollection, type HtmlProtectionSemanticComponent } from "./server-html-protection-semantic-observation";
const html = '<!doctype html><html><head></head><body><article class="slide-card" id="one"><h2>Method</h2><p>Original full meaning</p></article></body></html>';
function frozenRequirements(requirement = "Refine body text of card #one", editableItems = ["Only body text of card #one"]) {
  const rubric = [AcceptanceCriterionSchema.parse({ id: "PROTECT-ALL", title: "Preserve Original", requirement: "Preserve all original content and methods", hardGate: true, protectedConstraint: true, artifactIds: ["source"] }),
    AcceptanceCriterionSchema.parse({ id: "REFINE", title: "Explicit refinement", requirement, source: "user-command", hardGate: true, validationMethod: "semantic-judge", artifactIds: ["source"] })];
  const testCase = TestCaseSchema.parse({ id: "H", title: "Full frozen case", input: "Full Original", expected: ["Frozen explicit scope"], hidden: true, criterionIds: ["PROTECT-ALL", "REFINE"] });
  return HtmlProtectionSemanticFrozenRequirementsSchema.parse({ schemaVersion: "html-protection-semantic-frozen-requirements-v1", missionId: "mission", sourceArtifactId: "source", criterionId: "PROTECT-ALL", paperSha256: "1".repeat(64),
    testCase, paper: [testCase], rubric, goal: "Retain Original meaning", evolutionCommand: requirement, protectedItems: ["all original methods"], editableItems });
}
function fixture() {
  const frozen = frozenRequirements(), plan = htmlProtectionObligationPlan({ originalInventory: htmlProtectionInventory({ sourceArtifactId: "source", html }), frozenContentContract: { protectionCriterionId: frozen.criterionId, rubric: frozen.rubric } });
  const native = { value: { snapshot: { strings: ["HTML", "ARTICLE", "id", "one", "#text", "Original full meaning"], documents: [{ nodes: { parentIndex: [-1,0,1], nodeType: [1,1,3], nodeName: [0,1,4], nodeValue: [0,0,5], attributes: [[],[2,3],[]] } }] } } };
  const components = prepareServerHtmlProtectionSemanticComponents({ plan, originalHtml: html, executedHtml: html, originalNativeDocument: native, executedNativeDocument: native,
    executedInventory: plan.originalInventory, nativeComplete: true, frozenRequirements: frozen });
  const raw = makeRaw(components);
  return { plan, native, components, raw, frozenRequirements: frozen, args: { components, required: plan.requiredObligations, raw: [raw], frozenRequirements: frozen } };
}
function makeRaw(components:readonly HtmlProtectionSemanticComponent[]):HtmlProtectionSemanticObservations{return {schemaVersion:"html-protection-semantic-observations-v3",observations:prepareServerHtmlProtectionSemanticSegments(components).map(item=>({
  obligationId:item.obligationId,observationId:item.observationId,observationOrigin:"selected-model",originalRenderedRange:item.originalRenderedRange,executedRenderedRange:item.executedRenderedRange,
  originalContentSha256:item.originalContentSha256,executedContentSha256:item.executedContentSha256,originalRenderedSha256:item.originalRenderedSha256,executedRenderedSha256:item.executedRenderedSha256,requirementsSha256:item.requirementsSha256,
  status:"retained",originalCitations:[{start:0,end:Math.min(400,item.originalContent.length),quote:item.originalContent.slice(0,400)}],executedCitations:[{start:0,end:Math.min(400,item.executedContent.length),quote:item.executedContent.slice(0,400)}],
  originalRenderedCitations:item.originalRenderedRange.end>item.originalRenderedRange.start?[{...item.originalRenderedRange,quote:item.originalRendered.slice(item.originalRenderedRange.start,item.originalRenderedRange.end)}]:[],
  executedRenderedCitations:item.executedRenderedRange.end>item.executedRenderedRange.start?[{...item.executedRenderedRange,quote:item.executedRendered.slice(item.executedRenderedRange.start,item.executedRenderedRange.end)}]:[],
  observedMeaning:"Actual full original method retained",differences:[]}))};}
describe("grounded full semantic observations", () => {
  it("maps every independent complete component without granting runtime or visual coverage", () => {
    const f = fixture(), result = validateServerHtmlProtectionSemanticObservations(f.args);
    expect(result.evidence.every(item => item.verificationStatus === "verified")).toBe(true);
    expect(result.supportedObligationIds).toEqual(f.components.map(item => item.obligationId));
  });
  it.each(["quote", "hash", "requirements-hash", "duplicate", "foreign", "native-short", "native-quote"] as const)("rejects %s observation claims", kind => {
    const f = fixture(), row = f.raw.observations[0]!;
    if (kind === "quote") row.originalCitations[0]!.quote = "invented";
    if (kind === "hash") row.executedRenderedSha256 = "f".repeat(64);
    if (kind === "requirements-hash") row.requirementsSha256 = "f".repeat(64);
    if (kind === "duplicate") f.raw.observations.push(structuredClone(row));
    if (kind === "foreign") row.obligationId = "foreign";
    if (kind === "native-short") { row.originalRenderedCitations[0]!.end = 1; row.originalRenderedCitations[0]!.quote = row.originalRenderedCitations[0]!.quote.slice(0,1); }
    if (kind === "native-quote") row.executedRenderedCitations[0]!.quote = "invented native text";
    expect(() => validateServerHtmlProtectionSemanticObservations(f.args)).toThrow();
  });
  it("retains omitted components as unverified", () => {
    const f = fixture(); f.raw.observations.pop();
    expect(validateServerHtmlProtectionSemanticObservations(f.args).evidence.at(-1)?.verificationStatus).toBe("unverified");
  });
  it("does not accept duplicate native IDs, partial document scope or invented main-world text", () => {
    const f = fixture(); f.native.value.snapshot.documents[0]!.nodes.attributes[0] = [2,3];
    const args = { plan: f.plan, originalHtml: html, executedHtml: html, originalNativeDocument: f.native, executedNativeDocument: f.native, executedInventory: f.plan.originalInventory, nativeComplete: true, frozenRequirements: f.frozenRequirements };
    expect(prepareServerHtmlProtectionSemanticComponents(args).find(item => item.obligationId === f.plan.scope.cards[0]!.semanticObligationId)?.available).toBe(false);
    expect(prepareServerHtmlProtectionSemanticComponents({ ...args, nativeComplete: false }).every(item => !item.available)).toBe(true);
    expect(prepareServerHtmlProtectionSemanticComponents({ ...args, originalNativeDocument: { text: "invented" } }).every(item => !item.available)).toBe(true);
  });
  it("uses deterministic full physical/native identity without an unnecessary model call",async()=>{
    const f=fixture(),observe=vi.fn(async()=>{throw Error("No model needed");});
    const result=await collectServerHtmlProtectionSemanticObservations({...f.args,binding:{},originalHtml:html,executedHtml:html},observe);
    expect(observe).not.toHaveBeenCalled();expect(result.metrics.modelRequests).toBe(0);expect(result.evidence.every(item=>item.verificationStatus==="verified")).toBe(true);
  });
  it("sends two full files and complete components plus complete registered batches to the selected connection",async()=>{
    const f=fixture();for(const component of f.components){component.executedContent+="detail";component.executedContentSha256=createHash("sha256").update(component.executedContent).digest("hex");}
    const raw=makeRaw(f.components),observe=vi.fn(async(payload:unknown)=>{const segments=(payload as {segments:Array<{observationId:string}>}).segments;return {...raw,observations:raw.observations.filter(item=>segments.some(segment=>segment.observationId===item.observationId))};});
    const result=await collectServerHtmlProtectionSemanticObservations({...f.args,binding:{},originalHtml:html,executedHtml:html+"detail"},observe);
    expect(observe.mock.calls[0]?.[0]).toMatchObject({fullPhysicalOriginalHtml:html,fullPhysicalExecutedHtml:html+"detail",frozenRequirements:f.frozenRequirements,sourceScopedCriteria:f.frozenRequirements.rubric});expect(result.evidence.every(item=>item.verificationStatus==="verified")).toBe(true);
  });
  it("registers every full native segment, rejects middle omissions, and preserves known changes despite missing segments",()=>{
    const f=fixture(),component={...f.components[0]!,originalRendered:"A".repeat(2501),executedRendered:"B".repeat(2601),originalRenderedSha256:createHash("sha256").update("A".repeat(2501)).digest("hex"),executedRenderedSha256:createHash("sha256").update("B".repeat(2601)).digest("hex")};
    const raw=makeRaw([component]),required=f.plan.requiredObligations.filter(item=>item.id===component.obligationId);
    expect(raw.observations).toHaveLength(3);raw.observations.splice(1,1);
    expect(validateServerHtmlProtectionSemanticObservations({components:[component],required,raw:[raw]}).evidence[0]?.verificationStatus).toBe("unverified");
    raw.observations[0]!.status="changed";raw.observations[0]!.differences=["Actual grounded meaning loss"];
    expect(validateServerHtmlProtectionSemanticObservations({components:[component],required,raw:[raw]}).evidence[0]?.verificationStatus).toBe("failed");
  });
  it("rejects exact-identity origin forgery when any full source or native character differs",()=>{
    const f=fixture();f.raw.observations[0]!.observationOrigin="exact-full-identity";f.components[0]!.executedContent+="different";
    expect(()=>validateServerHtmlProtectionSemanticObservations(f.args)).toThrow("exact-identity-fabricated");
  });
  it("refuses full-manifest overcapacity before making a sampled prefix of model requests",async()=>{
    const f=fixture(),component={...f.components[0]!,originalRendered:"A".repeat(100000),executedRendered:"B".repeat(100000),originalRenderedSha256:createHash("sha256").update("A".repeat(100000)).digest("hex"),executedRenderedSha256:createHash("sha256").update("B".repeat(100000)).digest("hex")};
    const args={components:[component],required:f.plan.requiredObligations.filter(item=>item.id===component.obligationId),binding:{},originalHtml:html,executedHtml:html,frozenRequirements:f.frozenRequirements};
    const planned=prepareServerHtmlProtectionSemanticCollection(args),observe=vi.fn(async()=>{throw Error("No oversized request");});
    expect(planned.metrics.modelRequests).toBe(50);expect(planned.gaps).toContain("html-protection-semantic-complete-manifest-model-capacity");
    const result=await collectServerHtmlProtectionSemanticObservations(args,observe);expect(observe).not.toHaveBeenCalled();expect(result.evidence[0]?.verificationStatus).toBe("unverified");
  });
});


describe("shared complete semantic INPUT only",()=>{
  it("shares repeated full source/native contexts while retaining every independently registered obligation decision",async()=>{
    const f=fixture(),a={...f.components[0]!,originalRendered:"A".repeat(25711),executedRendered:"B".repeat(25711),originalRenderedSha256:createHash("sha256").update("A".repeat(25711)).digest("hex"),executedRenderedSha256:createHash("sha256").update("B".repeat(25711)).digest("hex")},b={...a,obligationId:f.components[1]!.obligationId};
    const components=[a,b],required=f.plan.requiredObligations.filter(item=>components.some(component=>component.obligationId===item.id)),args={components,required,originalHtml:html,executedHtml:html,binding:{},frozenRequirements:f.frozenRequirements};
    const rows=makeRaw(components).observations,observe=vi.fn(async(payload:unknown)=>{const batch=(payload as {segments:Array<{observationId:string}>}).segments;return {schemaVersion:"html-protection-semantic-observations-v3",observations:rows.filter(row=>batch.some(item=>item.observationId===row.observationId))};});
    const plan=prepareServerHtmlProtectionSemanticCollection(args);expect(plan.metrics.registeredSegments).toBe(52);expect(plan.metrics.uniqueModelQuoteRanges).toBe(26);expect(plan.metrics.modelRequests).toBe(13);expect(plan.gaps).toEqual([]);
    const result=await collectServerHtmlProtectionSemanticObservations(args,observe);expect(observe).toHaveBeenCalledTimes(13);expect(result.supportedObligationIds).toEqual(components.map(component=>component.obligationId));
    const payload=observe.mock.calls[0]![0] as {componentContexts:unknown[];components:unknown[];segments:unknown[]};expect(payload.componentContexts).toHaveLength(1);expect(payload.components).toHaveLength(2);expect(payload.segments).toHaveLength(4);
    const saved=result.raw.map(batch=>({...batch,observations:batch.observations.filter(row=>row.obligationId!==b.obligationId)}));
    const restored=validateServerHtmlProtectionSemanticObservations({components,required,raw:saved});expect(restored.evidence.find(row=>row.obligationId===b.obligationId)?.verificationStatus).toBe("unverified");expect(restored.evidence.find(row=>row.obligationId===a.obligationId)?.verificationStatus).toBe("verified");
  });
  it.each(["invalid-attribute","invalid-name","unselected-cycle"] as const)("refuses the full native census when %s is malformed",kind=>{
    const f=fixture(),nodes=f.native.value.snapshot.documents[0]!.nodes;
    if(kind==="invalid-attribute")nodes.attributes[0]=[999];if(kind==="invalid-name")nodes.nodeName[0]=999;if(kind==="unselected-cycle"){nodes.parentIndex.push(3);nodes.nodeType.push(1);nodes.nodeName.push(0);nodes.nodeValue.push(0);nodes.attributes.push([]);}
    const args={plan:f.plan,originalHtml:html,executedHtml:html,originalNativeDocument:f.native,executedNativeDocument:f.native,executedInventory:f.plan.originalInventory,nativeComplete:true,frozenRequirements:f.frozenRequirements};
    expect(prepareServerHtmlProtectionSemanticComponents(args).every(component=>!component.available)).toBe(true);
  });
});

describe("complete frozen source-scoped semantic requirements",()=>{
  function pair(changed: "one" | "two" = "one", frozen = frozenRequirements()) {
    const originalHtml = '<!doctype html><html><head></head><body><article class="slide-card" id="one"><p>Alpha method</p></article><article class="slide-card" id="two"><p>Beta method</p></article></body></html>';
    const executedHtml = changed === "one" ? originalHtml.replace("Alpha method", "Alpha method with detail") : originalHtml.replace("Beta method", "Equivalent Beta wording");
    const native = (a: string, b: string) => ({ value: { snapshot: { strings: ["HTML", "BODY", "ARTICLE", "id", "one", "two", "#text", a, b], documents: [{ nodes: {
      parentIndex: [-1,0,1,2,1,4], nodeType: [1,1,1,3,1,3], nodeName: [0,1,2,6,2,6], nodeValue: [0,0,0,7,0,8], attributes: [[],[],[3,4],[],[3,5],[]],
    } }] } } });
    const plan = htmlProtectionObligationPlan({ originalInventory: htmlProtectionInventory({ sourceArtifactId: "source", html: originalHtml }),
      frozenContentContract: { protectionCriterionId: frozen.criterionId, rubric: frozen.rubric } });
    const components = prepareServerHtmlProtectionSemanticComponents({ plan, originalHtml, executedHtml, frozenRequirements: frozen,
      originalNativeDocument: native("Alpha method", "Beta method"), executedNativeDocument: native(changed === "one" ? "Alpha method with detail" : "Alpha method", changed === "two" ? "Equivalent Beta wording" : "Beta method"),
      executedInventory: htmlProtectionInventory({ sourceArtifactId: "source", html: executedHtml }), nativeComplete: true });
    return { plan, components, originalHtml, executedHtml, frozenRequirements: frozen, required: plan.requiredObligations, binding: {} };
  }
  it("sends the complete authenticated-input-shaped frozen requirements and permits only the independently registered A body scope", async()=>{
    const args = pair(), rows = makeRaw(args.components).observations;
    const observe = vi.fn(async(payload: unknown)=>{ const data = payload as { segments: Array<{observationId:string}> };
      return { schemaVersion: "html-protection-semantic-observations-v3", observations: rows.filter(row=>data.segments.some(segment=>segment.observationId===row.observationId)) }; });
    const result = await collectServerHtmlProtectionSemanticObservations(args, observe);
    expect(result.evidence.every(item=>item.verificationStatus==="verified")).toBe(true);
    expect(observe.mock.calls[0]![0]).toMatchObject({frozenRequirements:args.frozenRequirements,requirementsSha256:args.components[0]!.requirementsSha256,
      sourceScopedCriteria:args.frozenRequirements.rubric});
    expect(args.components.find(item=>item.obligationId===args.plan.scope.cards[1]!.contentObligationId)?.requirementScope).toMatchObject({mode:"literal-retention",editableCardIds:["one"]});
  });
  it("retains a B wording violation despite every fake model observation saying retained when only A is editable",()=>{
    const args = pair("two"), result = validateServerHtmlProtectionSemanticObservations({...args,raw:[makeRaw(args.components)]});
    for(const id of [args.plan.scope.cards[1]!.contentObligationId,args.plan.scope.cards[1]!.semanticObligationId,args.plan.scope.document.content,args.plan.scope.document.semantic]) {
      expect(result.evidence.find(item=>item.obligationId===id)?.verificationStatus).toBe("failed");
    }
    expect(result.evidence.find(item=>item.obligationId===args.plan.scope.cards[0]!.semanticObligationId)?.verificationStatus).toBe("verified");
  });
  it.each([
    ["Refine body text of the introductory card","Only body text of the introductory card"],
    ["Refine body text of card #missing","Only body text of card #missing"],
    ["Refine all body text except card #two","All body text except card #two"],
    ["Refine body text of card #one but not card #two","Only body text of card #one"],
  ])("keeps an unknown/narrower scope unavailable: %s",async(requirement,editable)=>{
    const args = pair("two",frozenRequirements(requirement,[editable])), observe=vi.fn(async()=>{throw Error("Unknown scope cannot request permission from the model");});
    expect(validateServerHtmlProtectionSemanticObservations({...args,raw:[makeRaw(args.components)]}).evidence.every(item=>item.verificationStatus==="unverified")).toBe(true);
    const result = await collectServerHtmlProtectionSemanticObservations(args,observe);
    expect(observe).not.toHaveBeenCalled(); expect(result.supportedObligationIds).toEqual([]); expect(result.gaps.length).toBeGreaterThan(0);
  });
  it("rejects request reuse after any frozen permission/paper field changes before model dispatch",()=>{
    const args=pair(), frozen=structuredClone(args.frozenRequirements); frozen.editableItems=["All body text"];
    expect(()=>prepareServerHtmlProtectionSemanticCollection({...args,frozenRequirements:frozen})).toThrow("request-frozen-requirements-drift");
    frozen.editableItems=args.frozenRequirements.editableItems; frozen.paper[0]!.input+="another input";
    expect(()=>prepareServerHtmlProtectionSemanticCollection({...args,frozenRequirements:frozen})).toThrow("request-frozen-requirements-drift");
  });
  it("refuses legacy observations without the complete frozen requirements binding",()=>{
    const args=pair(),raw=makeRaw(args.components),row=raw.observations[0]!;
    const {requirementsSha256,...unbound}=row;void requirementsSha256;
    expect(()=>validateServerHtmlProtectionSemanticObservations({...args,raw:[{schemaVersion:"html-protection-semantic-observations-v3",observations:[unbound]}]})).toThrow();
  });
});
