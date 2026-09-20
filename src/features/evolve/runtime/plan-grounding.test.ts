import { describe, expect, it } from "vitest";
import { jsonSchemas } from "../ai/json-schemas";
import { CandidateSchema, type EvolveProject } from "../schemas";
import type { PlanAiResult } from "../ai/schemas";
import { flagUngroundedCandidates, planGroundingContext } from "./plan-grounding";

function candidate(overrides: Record<string, unknown> = {}) {
  return CandidateSchema.parse({ id: "A", name: "Candidate A", title: "T", change: "C", ...overrides });
}

function plan(candidates: ReturnType<typeof candidate>[]): PlanAiResult {
  return { candidates, recommendedCandidateIds: candidates.map((item) => item.id), summary: "s", experimentDesign: [] };
}

function project(overrides: Partial<EvolveProject> = {}): EvolveProject {
  return {
    id: "p1",
    selectedProblemId: "p1",
    problems: [{ id: "p1", title: "结论缺证据", summary: "s", rootCause: "rc", evidence: ["e1"] }],
    acceptanceRubric: [{ id: "c1", title: "关键结论有证据", requirement: "r", hardGate: true, weight: 30, category: "outcome" }],
    metrics: [{ key: "evidence", label: "证据完整率", value: 71, unit: "%", target: 90, trend: -1, direction: "higher" }],
    baselineRun: { result: { failures: ["关键结论未绑定来源"] } },
    ...overrides,
  } as unknown as EvolveProject;
}

describe("plan-grounding · 方案论证链契约", () => {
  it("候选 schema：旧数据无 designRationale 仍可解析；新数据保留论证链", () => {
    expect(candidate().designRationale).toBeUndefined();
    const withRationale = candidate({ designRationale: { sourceEvidence: ["原文引用"], mechanism: "m" } });
    expect(withRationale.designRationale?.sourceEvidence).toEqual(["原文引用"]);
    expect(withRationale.designRationale?.commandAlignment).toBe("");
    expect(withRationale.designRationale?.coveredCriteria).toEqual([]);
  });

  it("JSON Schema：plan 的每个候选必填 designRationale 六要素", () => {
    const item = (jsonSchemas.plan.schema.properties.candidates as unknown as { items: { required: readonly string[]; properties: { designRationale: { required: readonly string[] } } } }).items;
    expect(item.required).toContain("designRationale");
    expect(item.properties.designRationale.required).toEqual(expect.arrayContaining(["sourceEvidence", "commandAlignment", "mechanism", "coveredCriteria", "protectedCompliance", "falsifier"]));
  });

  it("兜底校验：缺源证据或机制链的候选被标记，完整候选不动", () => {
    const grounded = candidate({ designRationale: { sourceEvidence: ["原文引用"], mechanism: "m" } });
    const floating = candidate();
    const { result, ungroundedCount } = flagUngroundedCandidates(plan([grounded, floating]));
    expect(ungroundedCount).toBe(1);
    expect(result.candidates[0]?.notes).toEqual([]);
    expect(result.candidates[1]?.notes.join("")).toContain("设计论证不完整");
  });

  it("grounding 上下文：验收标准 / 指标 / 基线失败 / 选中问题都进 payload", () => {
    const context = planGroundingContext(project());
    expect(context.acceptanceRubric.map((item) => item.title)).toEqual(["关键结论有证据"]);
    expect(context.acceptanceRubric[0]?.hardGate).toBe(true);
    expect(context.metrics[0]?.key).toBe("evidence");
    expect(context.baselineFailures).toEqual(["关键结论未绑定来源"]);
    expect(context.selectedProblem?.title).toBe("结论缺证据");
  });
});
