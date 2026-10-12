import { describe, expect, it } from "vitest";
import type { AcceptanceCriterion, EvolveProject } from "@evolution/contracts";
import { baselineDeferredComparisonCriterionIds } from "./baseline-comparison-phase";
const items=["原始 HTML 格式","全部原始卡片"];
const protect: AcceptanceCriterion={id:"PROTECT-ALL",title:"Protection",requirement:items.join("；"),source:"protected-item",weight:8,hardGate:true,judgeType:"pairwise",validationMethod:"semantic-judge",minScore:95,evidenceExpected:items.map(item=>"与原始版本对比确认未破坏："+item),protectedConstraint:true,artifactIds:[],category:"protected"};
function fixture(){return {acceptanceRubric:[protect],protectedItems:[...items],campaign:{currentRound:0},searchChampion:undefined as EvolveProject["searchChampion"]};}
describe("visible original Baseline comparison phase",()=>{
 it("defers the canonical relation without removing current integrity",()=>{const p=fixture();p.acceptanceRubric=[protect,{...protect,id:"SYS-INTEGRITY",judgeType:"integrity",validationMethod:"static-structure",category:"integrity"}];expect([...baselineDeferredComparisonCriterionIds(p)]).toEqual(["PROTECT-ALL"]);});
 it.each<Partial<AcceptanceCriterion>>([{id:"CUSTOM-PROTECTION"},{source:"user-command"},{judgeType:"llm"},{validationMethod:"manual-review"},{protectedConstraint:false},{hardGate:false},{category:"integrity"},{requirement:"Current readability requirement"},{evidenceExpected:["Inspect current content only"]}])("does not defer a noncanonical contract %j",(patch)=>{const p=fixture();p.acceptanceRubric=[{...protect,...patch}];expect(baselineDeferredComparisonCriterionIds(p).size).toBe(0);});
 it("keeps an unmapped protected item required",()=>{const p=fixture();p.protectedItems.push("额外保护内容");expect(baselineDeferredComparisonCriterionIds(p).size).toBe(0);});
 it("does not defer current preservation after a Champion or later round",()=>{const p=fixture();p.searchChampion={} as NonNullable<EvolveProject["searchChampion"]>;expect(baselineDeferredComparisonCriterionIds(p).size).toBe(0);p.searchChampion=undefined;p.campaign.currentRound=1;expect(baselineDeferredComparisonCriterionIds(p).size).toBe(0);});
 it("retains the existing relative improvement deferral",()=>{const p=fixture();p.acceptanceRubric=[{...protect,id:"SYS-PAIRWISE"}];p.campaign.currentRound=2;expect([...baselineDeferredComparisonCriterionIds(p)]).toEqual(["SYS-PAIRWISE"]);});
});
