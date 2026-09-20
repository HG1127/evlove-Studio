import { describe, expect, it } from "vitest";
import type { EvolveProject } from "../schemas";
import { goalReadiness } from "./goal-readiness";
import { resetDownstream } from "./downstream";

const project = () => ({goal:"新人独立操作",sourceArtifacts:[{id:"s",name:"sop.md",extension:"md",artifactKind:"document",role:"target",parseStatus:"parsed",warnings:[]}],inputUnderstanding:{status:"ready",clarifications:[{question:"自学还是培训？",defaultAnswer:"自学"}]},inputClarifications:[]}) as unknown as EvolveProject;
describe("目标确认与旧结论失效", () => {
  it("AI 默认答案不能自动视为用户确认", () => { expect(goalReadiness(project()).ready).toBe(false); });
  it("明确回答后可继续，缺少读取能力仍阻止", () => {
    const p = project(); p.inputClarifications = [{question:"自学还是培训？",answer:"自学",answeredBy:"user",at:"now"}];
    expect(goalReadiness(p).ready).toBe(true);
    p.sourceArtifacts[0].parseStatus = "binary";
    expect(goalReadiness(p).ready).toBe(false);
  });
  it("输入变化清除当前冠军和断点，但保留版本历史", () => {
    const p = {...project(),stage:"validation",gates:[],acceptanceRubricState:{version:1},artifactAcceptance:{maxRepairAttempts:0},campaign:{schedule:{enabled:true},checkpoint:{round:1}},searchChampion:{id:"old"},versions:[{id:"history"}]} as unknown as EvolveProject;
    const next = resetDownstream(p, {invalidateUnderstanding:true});
    expect(next.inputUnderstanding).toBeUndefined(); expect(next.inputClarifications).toEqual([]);
    expect(next.searchChampion).toBeUndefined(); expect(next.campaign.checkpoint).toBeUndefined(); expect(next.versions).toEqual(p.versions); expect(next.campaign.schedule.enabled).toBe(false);
  });
});
