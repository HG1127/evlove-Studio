import { describe, expect, it } from "vitest";
import type { SourceArtifact } from "../schemas";
import { compileSemanticEvolution } from "./semantic-evolution";

function zipArtifact(name: string, paths: Array<[string,string]>, text = ""): SourceArtifact {
  return {
    id: `artifact-${name}`, name, role: "target", artifactKind: "generic", mimeType: "application/zip", size: 1024,
    extension: "zip", inputMode: "upload", parseStatus: "ready", textContent: text, textExcerpt: text.slice(0,1200),
    structure: paths.map(([path]) => path),
    structuredContent: { kind: "package", manifest: paths.map(([path]) => path), entries: paths.map(([path,family]) => ({ path, family })) },
    warnings: [], createdAt: new Date().toISOString(),
  };
}

describe("Semantic Evolve Runtime", () => {
  it("treats ZIP as container and recognizes a fundraising data room", () => {
    const result=compileSemanticEvolution({
      artifacts:[zipArtifact("融资资料.zip",[["商业计划书.pptx","presentation"],["财务模型.xlsx","spreadsheet"],["公司介绍.docx","document"],["产品截图/01.png","image"]])],
      command:"优化这套融资资料，让投资人更容易理解项目，保证财务模型和BP数字一致",
    });
    expect(result.semanticEvolution.semanticObject.typeId).toBe("fundraising-data-room");
    expect(result.semanticEvolution.workflowStages.map((stage)=>stage.label)).toEqual(["融资目标","资料关系","说服力诊断","分成果进化","联合验收","资料包交付"]);
    expect(result.artifactGraph.nodes.some((node)=>node.artifactFamily==="presentation")).toBe(true);
    expect(result.artifactGraph.nodes.some((node)=>node.artifactFamily==="spreadsheet")).toBe(true);
  });

  it("recognizes real code structure without making every ZIP a codebase", () => {
    const code=compileSemanticEvolution({artifacts:[zipArtifact("system.zip",[["package.json","structured-data"],["src/App.tsx","code"],["src/api.ts","code"],["tests/app.test.ts","code"]],"React Agent API schema runtime")],command:"优化系统并保持接口兼容"});
    const docs=compileSemanticEvolution({artifacts:[zipArtifact("业务资料.zip",[["说明.docx","document"],["接口说明.pdf","document"],["流程.xlsx","spreadsheet"]],"业务资料里有 API 字段说明，但这不是软件工程")],command:"整理业务规则，不要当成代码工程"});
    expect(code.semanticEvolution.semanticObject.typeId).toBe("software-system");
    expect(docs.semanticEvolution.semanticObject.typeId).not.toBe("software-system");
  });

  it("compiles strategy-specific workflow and a 100-point semantic rubric", () => {
    const result=compileSemanticEvolution({artifacts:[zipArtifact("战略经营包.zip",[["战略规划.pptx","presentation"],["经营目标.xlsx","spreadsheet"],["组织架构.docx","document"],["OKR.xlsx","spreadsheet"]])],command:"让战略目标真正落实到部门OKR，统一数字口径"});
    expect(result.semanticEvolution.semanticObject.typeId).toBe("strategy-operating-system");
    expect(result.semanticEvolution.workflowStages.some((stage)=>stage.label.includes("战略"))).toBe(true);
    expect(result.semanticEvolution.acceptanceRubric.reduce((sum,item)=>sum+item.weight,0)).toBeCloseTo(100,2);
  });
});

it("keeps real codebase classification when AI drifts toward a business fixture mentioned in tests", () => {
  const artifact = zipArtifact("EvolveStudio.zip", [
    ["package.json","structured-data"],
    ["src/App.tsx","code"],
    ["src/features/evolve/runtime/workflow-engine.ts","code"],
    ["src/features/evolve/components/evolution-composer.tsx","code"],
    ["tests/semantic-evolution.test.ts","code"],
  ], "系统成果物输入兼容 流程闭环 UIUX");
  artifact.artifactKind = "codebase";
  const result = compileSemanticEvolution({
    artifacts: [artifact],
    command: "进化该系统，从系统成果物输入兼容、流程完整闭环、UIux更符合产品审美和操作习惯等角度去进化。",
    aiSemanticObject: {
      typeId: "fundraising-data-room",
      label: "融资资料体系",
      description: "错误地被 test fixture 带偏",
      confidence: 0.91,
      primaryOutcome: "融资",
    },
  });
  expect(result.semanticEvolution.semanticObject.typeId).toBe("software-system");
  expect(result.semanticEvolution.workflowStages.map((stage)=>stage.label)).toEqual(["产品目标","系统建模","产品诊断","系统进化","双层验收","工程交付"]);
  expect(result.semanticEvolution.semanticObject.reasoning.join(" ")).toContain("忽略与工程结构冲突");
});
