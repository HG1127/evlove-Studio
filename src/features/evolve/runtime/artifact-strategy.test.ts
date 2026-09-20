import { describe, expect, it } from "vitest";
import type { SourceArtifact } from "../schemas";
import { describeArtifact, resolveProjectArtifactStrategy } from "./artifact-strategy";
import { normalizeAcceptanceRubric, rubricWeightTotal } from "./acceptance-rubric";

function artifact(name: string, artifactKind: SourceArtifact["artifactKind"], structure: string[] = []): SourceArtifact {
  return {
    id: name,
    name,
    role: "target",
    artifactKind,
    mimeType: "application/octet-stream",
    size: 100,
    extension: name.split(".").pop() ?? "",
    inputMode: "upload",
    parseStatus: "ready",
    structure,
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

const userCriterion = {
  id: "REQ-1",
  title: "用户目标",
  requirement: "必须满足用户原始进化要求",
  source: "user-command" as const,
  weight: 100,
  hardGate: true,
  judgeType: "llm" as const,
  validationMethod: "semantic-judge" as const,
  minScore: 90,
  evidenceExpected: ["可验证证据"],
  protectedConstraint: false,
  artifactIds: [],
  category: "outcome" as const,
};

describe("Universal Adaptive Artifact Strategy", () => {
  it.each([
    ["deck.pptx", "presentation" as const, "presentation-pptx-ooxml", "same-package"],
    ["report.docx", "document" as const, "document-docx-ooxml", "same-package"],
    ["book.xlsx", "spreadsheet" as const, "spreadsheet-xlsx", "same-format-rebuild"],
    ["agent.json", "workflow" as const, "workflow-structured", "same-text-format"],
    ["system-prompt.md", "prompt" as const, "prompt-text", "same-text-format"],
    ["knowledge.md", "knowledge" as const, "knowledge-corpus", "same-text-format"],
    ["fixed.pdf", "document" as const, "document-pdf-readonly", "external-required"],
    ["demo.mp4", "media" as const, "media-external", "external-required"],
  ])("detects %s and selects a native adapter", (name, kind, adapterId, preservationMode) => {
    const descriptor = describeArtifact(artifact(name, kind));
    expect(descriptor.adapterId).toBe(adapterId);
    expect(descriptor.preservationMode).toBe(preservationMode);
  });

  it("detects a ZIP repository as codebase from its native file tree", () => {
    const descriptor = describeArtifact(artifact("app.zip", "codebase", ["package.json", "src/App.tsx", "src/lib/api.ts"]));
    expect(descriptor.adapterId).toBe("codebase-zip-repository");
    expect(descriptor.preservationMode).toBe("same-package");
  });

  it("uses different quality contracts for PPT, code and workflow", () => {
    const ppt = artifact("deck.pptx", "presentation");
    const code = artifact("app.zip", "codebase", ["package.json", "src/App.tsx"]);
    const workflow = artifact("agent.json", "workflow");
    const pptRubric = normalizeAcceptanceRubric([userCriterion], { protectedItems: [], sourceArtifacts: [ppt] });
    const codeRubric = normalizeAcceptanceRubric([userCriterion], { protectedItems: [], sourceArtifacts: [code] });
    const workflowRubric = normalizeAcceptanceRubric([userCriterion], { protectedItems: [], sourceArtifacts: [workflow] });
    const titles = (items: typeof pptRubric) => items.filter((item) => item.category === "artifact-specific").map((item) => item.title).join("|");
    expect(titles(pptRubric)).toMatch(/页|PPT|演示|可编辑|版式/);
    expect(titles(codeRubric)).toMatch(/代码|工程|构建|测试|接口|ZIP/);
    expect(titles(workflowRubric)).toMatch(/节点|流程|工作流|异常|状态|契约/);
    expect(titles(pptRubric)).not.toBe(titles(codeRubric));
    expect(titles(workflowRubric)).not.toBe(titles(codeRubric));
  });

  it("allocates acceptance weight according to artifact type while keeping total at 100", () => {
    const code = artifact("app.zip", "codebase", ["package.json", "src/App.tsx"]);
    const rubric = normalizeAcceptanceRubric([userCriterion], { protectedItems: ["不得删除原接口"], sourceArtifacts: [code] });
    const strategy = resolveProjectArtifactStrategy({ sourceArtifacts: [code] });
    expect(strategy.userGoalBudget).toBe(50);
    expect(strategy.artifactBudget).toBe(40);
    expect(rubricWeightTotal(rubric)).toBeCloseTo(100, 2);
    expect(rubric.some((item) => item.category === "artifact-specific" && item.hardGate)).toBe(true);
  });


  it("adapts user-facing stage names to the artifact type", () => {
    const ppt = resolveProjectArtifactStrategy({ sourceArtifacts: [artifact("deck.pptx", "presentation")] });
    const code = resolveProjectArtifactStrategy({ sourceArtifacts: [artifact("app.zip", "codebase", ["package.json", "src/App.tsx"])] });
    const workflow = resolveProjectArtifactStrategy({ sourceArtifacts: [artifact("agent.json", "workflow")] });
    expect(ppt.stages.map((item) => item.label)).toEqual(["目标与结构", "逐页体检", "叙事诊断", "演示重构", "页级验收", "演示交付"]);
    expect(code.stages.map((item) => item.label)).toEqual(["需求契约", "工程体检", "缺陷定位", "构建候选", "测试验收", "工程交付"]);
    expect(workflow.stages.map((item) => item.label)).toEqual(["流程目标", "流程体检", "卡点定位", "流程重构", "闭环验收", "流程交付"]);
  });

  it("uses per-artifact strategies for mixed targets", () => {
    const project = { sourceArtifacts: [artifact("deck.pptx", "presentation"), artifact("app.zip", "codebase", ["package.json", "src/App.tsx"])] };
    const strategy = resolveProjectArtifactStrategy(project);
    expect(strategy.id).toBe("mixed-artifacts");
    expect(strategy.outputMode).toMatch(/原格式/);
    expect(strategy.artifactBudget).toBe(40);
  });
});
