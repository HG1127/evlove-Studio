import { expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema } from "../schemas";
import { demoProject } from "../data/mock-project";

const mocks = vi.hoisted(() => ({ evaluateRuns: vi.fn() }));
vi.mock("../evaluation/service", () => ({ evaluateRuns: mocks.evaluateRuns }));

import { BaselineEvaluationError, runBaseline } from "./run-local";

it("preserves a failed Baseline Judge call as a distinct resumable error", async () => {
  const rubric = [
    { id: "REQ-1", title: "重要结论有证据", requirement: "关键结论必须绑定可验证来源", weight: 40, hardGate: true, evidenceExpected: ["结论附来源引用"] },
    { id: "REQ-2", title: "风险分析完整", requirement: "风险分析包含反证与下行情景", weight: 30, evidenceExpected: ["反证条件与下行情景文本"] },
    { id: "REQ-3", title: "成本不显著增加", requirement: "平均成本不明显高于基线", weight: 30, evidenceExpected: ["执行成本记录"] },
  ].map((item) => AcceptanceCriterionSchema.parse(item));
  const project = {
    ...demoProject,
    acceptanceRubric: rubric,
    acceptanceRubricState: { ...demoProject.acceptanceRubricState, status: "ready" as const, weightTotal: 100 },
    gates: demoProject.gates.map((gate) => gate.id === "target-ready" ? { ...gate, status: "approved" as const } : gate),
  };
  const failure = new Error("Judge connection lost");
  mocks.evaluateRuns.mockRejectedValueOnce(failure);
  await expect(runBaseline(project)).rejects.toMatchObject({
    name: "BaselineEvaluationError",
    message: "Judge connection lost",
    cause: failure,
  } satisfies Partial<BaselineEvaluationError>);
  expect(mocks.evaluateRuns).toHaveBeenCalledTimes(1);
});