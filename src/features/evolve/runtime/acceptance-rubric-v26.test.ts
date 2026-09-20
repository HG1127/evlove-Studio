import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema, TestCaseSchema, type AcceptanceCriterion } from "../schemas";
import { mapTestsToRubric, normalizeAcceptanceRubric, rubricSuiteCoverage } from "./acceptance-rubric";

describe("V2.6 acceptance rubric grounding", () => {
  it("anchors the user's actual product goals and removes internal implementation-shaped objectives", () => {
    const command = "进化该系统，从系统成果物输入兼容、流程完整闭环、UIux更符合产品审美和操作习惯等角度去进化。";
    const aiCriteria: AcceptanceCriterion[] = [
      { id:"BAD-1",title:"semantic-evolution.ts typeId",requirement:"semantic-evolution.ts 新增融资资料 typeId",source:"user-command",weight:25,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:90,evidenceExpected:["typeId"],protectedConstraint:false,artifactIds:[],category:"outcome" },
      { id:"BAD-2",title:"Tailwind token",requirement:"index.css 与 tailwind.config.js token 完整",source:"source-understanding",weight:25,hardGate:true,judgeType:"llm",validationMethod:"static-structure",minScore:90,evidenceExpected:["Tailwind token"],protectedConstraint:false,artifactIds:[],category:"outcome" },
    ];
    const normalized = normalizeAcceptanceRubric(aiCriteria, { protectedItems: [], sourceArtifacts: [], evolutionCommand: command });
    const ids = normalized.map((item)=>item.id);
    expect(ids).toContain("USER-INPUT-COMPAT");
    expect(ids).toContain("USER-WORKFLOW-CLOSURE");
    expect(ids).toContain("USER-UIUX");
    expect(normalized.some((item)=>/semantic-evolution|tailwind|typeid/i.test(`${item.title} ${item.requirement}`))).toBe(false);
    expect(normalized.length).toBeLessThanOrEqual(10);
  });
});

it("does not keep the fallback USER-PRIMARY-INTENT when an explicit user outcome already exists", () => {
  const explicit = AcceptanceCriterionSchema.parse({
    id:"R-USER-REFINE", title:"细化用户要求", requirement:"把工作流每一步细化成可直接操作的说明", source:"user-command", weight:50,
    hardGate:true, judgeType:"llm", validationMethod:"semantic-judge", minScore:90, evidenceExpected:["步骤可直接操作"], protectedConstraint:false, artifactIds:[], category:"outcome",
  });
  const staleFallback = AcceptanceCriterionSchema.parse({ id:"USER-PRIMARY-INTENT", title:"用户原始进化要求", requirement:"细化这个工作流的每一步，让它可以直接使用", source:"user-command", weight:40, hardGate:true, validationMethod:"semantic-judge", category:"outcome" });
  const normalized = normalizeAcceptanceRubric([explicit, staleFallback], { protectedItems:[], sourceArtifacts:[], evolutionCommand:"细化这个工作流的每一步，让它可以直接使用" });
  expect(normalized.some((item)=>item.id==="R-USER-REFINE")).toBe(true);
  expect(normalized.some((item)=>item.id==="USER-PRIMARY-INTENT")).toBe(false);
});

it("covers a hard criterion on the visible suite even when it already exists on holdout", () => {
  const criterion = AcceptanceCriterionSchema.parse({ id: "READ", title: "正文", requirement: "正文清楚", hardGate: true });
  const hidden = TestCaseSchema.parse({ id: "H1", title: "正文", input: "检查正文", expected: ["正文清楚"], hidden: true, criterionIds: ["READ"] });
  const result = mapTestsToRubric([criterion], [], [hidden]);
  expect(result.validationCases.some((item) => item.criterionIds.includes("READ"))).toBe(true);
  expect(result.hiddenCases).toHaveLength(1);
  expect(mapTestsToRubric([criterion], result.validationCases, result.hiddenCases)).toEqual(result);
});

it("reports stale suite coverage and confirms deterministic repair closes both gaps", () => {
  const primary = AcceptanceCriterionSchema.parse({ id: "USER-PRIMARY-INTENT", title: "核心目标", requirement: "完整落实用户核心目标", hardGate: true });
  const format = AcceptanceCriterionSchema.parse({ id: "ART-1-FORMAT", title: "原格式", requirement: "保持原格式交付", hardGate: true, validationMethod: "format-roundtrip" });
  const stale = TestCaseSchema.parse({ id: "OLD", title: "旧题", input: "旧检查", expected: ["旧要求"], hidden: false, criterionIds: [] });
  const before = rubricSuiteCoverage([primary, format], [stale], []);
  expect(before.ready).toBe(false);
  expect(before.uncovered).toEqual(["USER-PRIMARY-INTENT", "ART-1-FORMAT"]);
  expect(before.hiddenHardGateMissing.map((item) => item.id)).toEqual(["USER-PRIMARY-INTENT", "ART-1-FORMAT"]);
  const repaired = mapTestsToRubric([primary, format], [stale], []);
  const after = rubricSuiteCoverage([primary, format], repaired.validationCases, repaired.hiddenCases);
  expect(after.ready).toBe(true);
});
