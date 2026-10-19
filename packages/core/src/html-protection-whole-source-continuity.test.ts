// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema } from "@evolution/contracts";
import { htmlProtectionWholeRuntimeSourcePlan } from "./html-protection-whole-runtime-plan";
import { assessHtmlProtectionWholeSourceContinuity } from "./html-protection-whole-source-continuity";
import { htmlProtectionWholeSourceDependencyProfile } from "./html-protection-whole-source-dependencies";
const original={sourceArtifactId:"source",sha256:"a".repeat(64),byteLength:100};
const protect=AcceptanceCriterionSchema.parse({id:"PROTECT",title:"Protection",requirement:"保留章节结构、CSS样式和HTML交互",hardGate:true,protectedConstraint:true,artifactIds:["source"]});
const refine=AcceptanceCriterionSchema.parse({id:"DETAIL",title:"Detail",requirement:"正文配置细节得到有效细化，参数说明更完整",hardGate:true,artifactIds:["source"]});
const html='<!doctype html><html><head><style>.slide-card{display:block}</style></head><body><article class="slide-card" id="one" data-search="alpha"><h2>Heading</h2><p>Method</p><button class="copy-slide">Copy</button></article><script>document.querySelector("p").textContent.trim();</script></body></html>';
const assess=(executedHtml:string,rubric=[protect,refine])=>assessHtmlProtectionWholeSourceContinuity({sourcePlan:htmlProtectionWholeRuntimeSourcePlan({original,html}),originalHtml:html,executedHtml,frozenContentContract:{protectionCriterionId:protect.id,rubric}});
describe("complete physical source text dependency facts",()=>{
  it("retains all physical protected domains for a nontrivial same-node body refinement without granting source-only closure",()=>{const value=assess(html.replace("Method</p>","Method with a concrete configuration explanation</p>"));expect(value.sourceSignatureRetained).toBe(true);expect(value.changedTextNodePaths).toHaveLength(1);expect(value.parentDependencies[0]?.actualAllowedTextChangeCanAffectDependencies).toBe(true);expect(value.parentDependencies[0]?.sourceOnlyClosureAvailable).toBe(false);expect(value).not.toHaveProperty("supportedObligationIds");});
  it.each([['heading','Heading','Changed heading'],['control label','Copy','Altered control label'],['style','display:block','display:grid'],['script','textContent.trim()','innerHTML.trim()'],['attribute','data-search="alpha"','data-search="beta"']])("keeps %s changes as protected drift",(_,from,to)=>{expect(assess(html.replace(from,to)).sourceSignatureRetained).toBe(false)});
  it("does not treat semantic requirement shape as literal modification authority",()=>{const value=assess(html.replace("Method</p>","Detailed method</p>"),[protect]);expect(value.sourceSignatureRetained).toBe(false);expect(value.gaps).toContain("protected-or-unlicensed-source-text-drift");});
  it("does not allow new element identity or source-domain expansion",()=>{expect(assess(html.replace("Method</p>","Method<span>new region</span></p>")).sourceSignatureRetained).toBe(false)});
  it("full source profiles keep mutable text and ambient/computed dependencies explicit",()=>{const p=htmlProtectionWholeRuntimeSourcePlan({original,html:html.replace('textContent.trim();','innerHTML.trim(); const value=document.body[key];')});const value=htmlProtectionWholeSourceDependencyProfile(p)[0]!;expect(value.textMutationCanAffectDependencies).toBe(true);expect(value.gaps).toContain("dynamic-dependency-receiver-unresolved");expect(value.reads.map(r=>r.kind)).toContain("markup");expect(value.reads.map(r=>r.kind)).toContain("unknown");});
});
