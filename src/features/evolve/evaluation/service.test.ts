import { expect, it } from "vitest";
import { criteriaRequiringJudge, deriveCriterionScores, evaluatorReviewAllocation } from "./service";
import { AcceptanceCriterionSchema, type TargetRunResult, type TestCase } from "../schemas";

it("shares one bounded evidence budget across holdout runs", () => {
  const few = evaluatorReviewAllocation({mode:"holdout"}, 2);
  const many = evaluatorReviewAllocation({mode:"holdout"}, 10);
  expect(few.total).toBe(24000);
  expect(few.perRun).toBe(7500);
  expect(many.perRun).toBe(2400);
  expect(many.perRun * 10).toBeLessThanOrEqual(many.total);
});

it("uses a smaller evidence budget for targeted repair checks without changing full holdout budget", () => {
  const focused = evaluatorReviewAllocation({mode:"repair-focus"}, 2);
  const holdout = evaluatorReviewAllocation({mode:"holdout"}, 2);
  expect(focused.total).toBe(9000);
  expect(focused.perRun).toBe(4200);
  expect(holdout.total).toBe(24000);
  expect(holdout.perRun).toBe(7500);
});

it("does not turn missing judge detail into a verified zero-score failure", () => {
  const criterion = AcceptanceCriterionSchema.parse({ id: "C1", title: "小白易理解", requirement: "步骤必须清楚", hardGate: true, minScore: 85 });
  const testCase = { id: "H1", title: "检查步骤", input: "", expected: ["步骤清楚"], tags: [], criterionIds: [criterion.id], hidden: true, executionMode: "artifact-runtime", evidenceScope: "product-behavior" } as TestCase;
  const run = { testCaseId: testCase.id, output: "完整页面内容", latencyMs: 1, cost: 0, trace: [], verificationStatus: "verified" } as TargetRunResult;
  const missing = deriveCriterionScores([criterion], [testCase], [], [run]);
  expect(missing.criterionScores[0]).toMatchObject({ score: 0, pass: false, verificationStatus: "unverified" });
  expect(missing.criterionScores[0]?.gaps.join(" ")).toContain("评审模型未返回");
  expect(missing.unverifiedCriterionIds).toEqual([criterion.id]);

  const judged = deriveCriterionScores([criterion], [testCase], [{ testCaseId: testCase.id, accuracy: 90, evidence: 90, completeness: 90, reason: "步骤明确" }], [run]);
  expect(judged.criterionScores[0]).toMatchObject({ score: 90, pass: true, verificationStatus: "verified" });
});

it("settles verified deterministic format roundtrip without depending on an omitted LLM rubric row", () => {
  const criterion = AcceptanceCriterionSchema.parse({ id: "FORMAT", title: "原格式交付", requirement: "TXT 可原格式交付", hardGate: true, minScore: 90, validationMethod: "format-roundtrip" });
  const testCase = { id: "H-FORMAT", title: "格式", input: "", expected: ["roundtrip"], tags: [], criterionIds: [criterion.id], hidden: true, executionMode: "roundtrip", evidenceScope: "format" } as TestCase;
  const run = { testCaseId: testCase.id, output: "CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED", latencyMs: 1, cost: 0, trace: [{ id:"rt", stage:"format-roundtrip", summary:"ok", status:"pass", detail:"preserved=true" }], verificationStatus: "verified" } as TargetRunResult;
  const result = deriveCriterionScores([criterion], [testCase], [], [run]);
  expect(result.criterionScores[0]).toMatchObject({ score: 100, pass: true, verificationStatus: "verified" });
  expect(result.unverifiedCriterionIds).toEqual([]);
});

it("keeps deterministic format criteria out of the semantic Judge contract", () => {
  const semantic = AcceptanceCriterionSchema.parse({ id:"USER", title:"用户目标", requirement:"流程更清晰", hardGate:true, validationMethod:"semantic-judge" });
  const format = AcceptanceCriterionSchema.parse({ id:"FORMAT", title:"原格式", requirement:"保持 TXT", hardGate:true, validationMethod:"format-roundtrip" });
  const semanticCase = { id:"H-USER", title:"用户目标", input:"检查流程", expected:["更清晰"], tags:[], criterionIds:[semantic.id], hidden:true, executionMode:"artifact-runtime", evidenceScope:"product-behavior" } as TestCase;
  const formatCase = { id:"H-FORMAT-2", title:"格式", input:"检查格式", expected:["roundtrip"], tags:[], criterionIds:[format.id], hidden:true, executionMode:"roundtrip", evidenceScope:"format" } as TestCase;
  const runs = [
    { testCaseId:semanticCase.id, output:"CURRENT CANDIDATE SNAPSHOT EVIDENCE", latencyMs:1, cost:0, trace:[], verificationStatus:"verified" as const },
    { testCaseId:formatCase.id, output:"CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED", latencyMs:0, cost:0, trace:[{id:"rt2",stage:"format-roundtrip",summary:"ok",status:"pass" as const,detail:"preserved=true"}], verificationStatus:"verified" as const },
  ];
  expect(criteriaRequiringJudge([semantic, format], [semanticCase, formatCase], runs).map((item)=>item.id)).toEqual([semantic.id]);
});

it("settles USER-PRIMARY-INTENT from the dedicated case judgement while ART-1-FORMAT stays deterministic", () => {
  const primary = AcceptanceCriterionSchema.parse({ id: "USER-PRIMARY-INTENT", title: "用户原始进化要求", requirement: "细化该文档的流程", hardGate: true, minScore: 85, validationMethod: "semantic-judge" });
  const format = AcceptanceCriterionSchema.parse({ id: "ART-1-FORMAT", title: "原格式交付", requirement: "最终成果保持 txt 格式", hardGate: true, minScore: 90, validationMethod: "format-roundtrip" });
  const semanticCase = { id: "H-PRIMARY", title: "核心目标", input: "检查流程是否细化", expected: ["流程更具体"], tags: [], criterionIds: [primary.id], hidden: true, executionMode: "artifact-runtime", evidenceScope: "product-behavior" } as TestCase;
  const formatCase = { id: "H-FORMAT", title: "格式", input: "检查 TXT", expected: ["roundtrip"], tags: [], criterionIds: [format.id], hidden: true, executionMode: "roundtrip", evidenceScope: "format" } as TestCase;
  const semanticRun = { testCaseId: semanticCase.id, output: "CURRENT CANDIDATE SNAPSHOT EVIDENCE", latencyMs: 1, cost: 0, trace: [], verificationStatus: "verified" } as TargetRunResult;
  const formatRun = { testCaseId: formatCase.id, output: "CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED", latencyMs: 0, cost: 0, trace: [{ id:"rt", stage:"format-roundtrip", summary:"ok", status:"pass", detail:"preserved=true" }], verificationStatus: "verified" } as TargetRunResult;
  const result = deriveCriterionScores([primary, format], [semanticCase, formatCase], [{ testCaseId:semanticCase.id, accuracy:92, evidence:90, completeness:94, reason:"步骤已细化并包含交付说明" }], [semanticRun, formatRun]);
  expect(result.criterionScores.find((item)=>item.criterionId===primary.id)).toMatchObject({ pass:true, verificationStatus:"verified" });
  expect(result.criterionScores.find((item)=>item.criterionId===format.id)).toMatchObject({ score:100, pass:true, verificationStatus:"verified" });
  expect(result.unverifiedCriterionIds).toEqual([]);
});

it("quarantines historical diagnosis citations instead of repairing the candidate against them", () => {
  const criterion = AcceptanceCriterionSchema.parse({ id: "C1", title: "易读", requirement: "正文易读", hardGate: true });
  const testCase = { id: "H1", criterionIds: ["C1"] } as TestCase;
  const run = { testCaseId: "H1", verificationStatus: "verified" } as TargetRunResult;
  const result = deriveCriterionScores([criterion], [testCase], [{ testCaseId: "H1", accuracy: 40, evidence: 80, completeness: 80, reason: "diagnosis.trace[4]: 原版字号不足" }], [run]);
  expect(result.criterionScores[0].verificationStatus).toBe("unverified");
  expect(result.criterionScores[0].gaps.join(" ")).toContain("历史诊断");
});
