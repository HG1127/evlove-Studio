import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema, CandidateSchema, SourceArtifactSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { mapTestsToRubric, normalizeAcceptanceRubric } from "./acceptance-rubric";
import { evidenceFingerprint } from "./evidence-binding";
import { evidenceRouteForCriterion, normalizeEvalSuiteForProject } from "./eval-suite-normalization";

const legacy = AcceptanceCriterionSchema.parse({
  id: "USER-WORKFLOW-CLOSURE", title: "流程完整闭环", source: "user-command", hardGate: true,
  requirement: "用户从输入、理解、诊断、进化、验证到交付应形成可理解、可继续、可回退的闭环；问题、原因、动作、结果和下一步必须分明。",
  validationMethod: "user-scenario", minScore: 92, evidenceExpected: ["前一阶段产出成为后一阶段输入"],
});
function fixture(kind: "document" | "codebase" = "document") {
  const source = SourceArtifactSchema.parse({ id: "sop", name: "配置教程.html", role: "target", artifactKind: kind,
    extension: kind === "document" ? "html" : "zip", mimeType: kind === "document" ? "text/html" : "application/zip", size: 100, createdAt: "2026-10-08T00:00:00Z", textContent: "<html><body>配置前准备→填写配置→检查结果→失败重试<script>function navigate(){}</script></body></html>" });
  const test = TestCaseSchema.parse({ id: "closure", title: "验收：流程完整闭环", input: "检查配置流程闭环", expected: ["检查完成条件"], criterionIds: [legacy.id] });
  return { sourceArtifacts: [source], acceptanceRubric: [legacy], protectedItems: [], metrics: [], hiddenEvalSuite: [test],
    evolutionCommand: "细化配置详情，补充完整流程与异常处理说明", goal: "降低 SOP 的理解难度", objectType: kind } as unknown as EvolveProject;
}

describe("document workflow acceptance", () => {
  it("checks the SOP workflow rather than imposing the Evolution OS execution loop", () => {
    const project = fixture();
    const normalized = normalizeAcceptanceRubric(project.acceptanceRubric, project);
    const closure = normalized.find((item) => item.id === legacy.id)!;
    expect(closure.validationMethod).toBe("semantic-judge");
    expect(closure.requirement).toContain("文档中描述的业务或操作流程");
    expect(closure.requirement).not.toContain("诊断、进化");
    expect(closure.minScore).toBe(92);
    expect(closure.hardGate).toBe(true);
    project.acceptanceRubric = normalized;
    expect(normalizeEvalSuiteForProject(project, [], project.hiddenEvalSuite).hiddenCases[0]?.executionMode).toBe("artifact-runtime");
    expect(evidenceRouteForCriterion(project, closure)).toBe("local");
  });
  it("invalidates old evidence without altering the candidate and normalizes idempotently", () => {
    const project = fixture();
    const candidate = CandidateSchema.parse({ id: "same", name: "新版 SOP", change: "细化", artifactSnapshots: [{ id: "snapshot", sourceArtifactId: "sop", name: "配置教程.html", mimeType: "text/html", content: project.sourceArtifacts[0]!.textContent, createdAt: "2026-10-08T00:00:00Z" }] });
    const before = evidenceFingerprint(project, candidate);
    const normalized = { ...project, acceptanceRubric: normalizeAcceptanceRubric(project.acceptanceRubric, project) };
    expect(evidenceFingerprint(normalized, candidate)).not.toBe(before);
    expect(normalizeAcceptanceRubric(normalized.acceptanceRubric, normalized)).toEqual(normalized.acceptanceRubric);
  });
  it("retains genuine software workflow scenarios as real Runner requirements", () => {
    const project = fixture("codebase");
    project.acceptanceRubric = normalizeAcceptanceRubric(project.acceptanceRubric, project);
    const closure = project.acceptanceRubric.find((item) => item.id === legacy.id)!;
    expect(closure.validationMethod).toBe("user-scenario");
    expect(evidenceRouteForCriterion(project, closure)).toBe("runner");
  });
  it("retains a standalone HTML application as a software scenario", () => {
    const project = fixture();
    project.semanticEvolution = { semanticObject: { typeId: "software-system" } } as EvolveProject["semanticEvolution"];
    project.acceptanceRubric = normalizeAcceptanceRubric(project.acceptanceRubric, project);
    const closure = project.acceptanceRubric.find((item) => item.id === legacy.id)!;
    expect(closure.validationMethod).toBe("user-scenario");
    expect(evidenceRouteForCriterion(project, closure)).toBe("runner");
  });
});
it("keeps mixed generated and custom goals at the same weights over repeated validation", () => {
  const project = fixture();
  project.acceptanceRubric.push(AcceptanceCriterionSchema.parse({ id: "CONFIG-DETAIL", title: "默认值说明", requirement: "每个配置字段写明可填写的默认值与示例", source: "user-command", weight: 45, hardGate: true, validationMethod: "semantic-judge", evidenceExpected: ["具体配置示例"] }));
  const normalized = normalizeAcceptanceRubric(project.acceptanceRubric, project);
  project.acceptanceRubric = normalized;
  const candidate = CandidateSchema.parse({ id: "current", name: "当前 SOP", change: "完善" });
  const binding = evidenceFingerprint(project, candidate);
  for (let attempt = 0; attempt < 4; attempt++) {
    project.acceptanceRubric = normalizeAcceptanceRubric(project.acceptanceRubric, project);
    expect(project.acceptanceRubric).toEqual(normalized);
    expect(new Set(project.acceptanceRubric.map((item) => item.id)).size).toBe(normalized.length);
    expect(evidenceFingerprint(project, candidate)).toBe(binding);
  }
});
it("refreshes a legacy auto-generated closure probe without rewriting authored scenarios", () => {
  const project = fixture();
  const rubric = normalizeAcceptanceRubric(project.acceptanceRubric, project);
  const saved = { ...project.hiddenEvalSuite[0]!, id: "holdout-criterion-user-workflow-closure-6", input: legacy.requirement, expected: legacy.evidenceExpected };
  const authored = { ...saved, id: "business-user-scenario" };
  const mapped = mapTestsToRubric(rubric, [], [saved, authored]).hiddenCases;
  expect(mapped.find((item) => item.id === saved.id)?.input).toContain("文档中描述的业务或操作流程");
  expect(mapped.find((item) => item.id === saved.id)?.input).not.toContain("诊断、进化");
  expect(mapped.find((item) => item.id === authored.id)?.input).toBe(authored.input);
});
it("preserves limited browser-coverage markers when refreshing a generated probe", () => {
  const project = fixture("codebase");
  const saved = { ...project.hiddenEvalSuite[0]!, id: "holdout-criterion-user-workflow-closure-6", tags: ["source-grounded-html-assertions"], browserSteps: [{ action: "click" as const, selector: "#search" }] };
  const refreshed = mapTestsToRubric([legacy], [], [saved]).hiddenCases[0]!;
  expect(refreshed.tags).toContain("source-grounded-html-assertions");
  expect(refreshed.browserSteps).toEqual(saved.browserSteps);
});