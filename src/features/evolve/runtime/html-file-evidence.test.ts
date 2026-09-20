import { artifactTargetAdapter } from "../target/artifact-adapter";
import { expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { EvolveProjectSchema, SourceArtifactSchema, TestCaseSchema, AcceptanceCriterionSchema } from "../schemas";
import { htmlFileEvidence } from "./html-file-evidence";
import { runStaticEvidence, runRoundtripEvidence } from "./static-evidence";

const fixture = () => {
  const project = EvolveProjectSchema.parse(structuredClone(demoProject));
  project.sourceArtifacts = [SourceArtifactSchema.parse({ ...project.sourceArtifacts[0], id: "html", role: "target", extension: "html", mimeType: "text/html", artifactKind: "document", textContent: '<!DOCTYPE html><html><head><title>教程</title></head><body><nav><a href="#slide-51">Git</a><a href="#missing">缺失</a></nav><article id="slide-51"><h2>Git步骤</h2><p>创建仓库</p></article></body></html>' })];
  const testCase = TestCaseSchema.parse({ id: "C1", title: "结构完整", input: "检查章节", expected: ["章节完整"], executionMode: "static-evidence", evidenceScope: "implementation" });
  return { project, testCase };
};

it("reads one complete HTML file instead of requiring two repository evidence files", async () => {
  const { project, testCase } = fixture();
  const result = await runStaticEvidence(project, testCase);
  expect(result.verificationStatus).toBe("verified");
  expect(result.output).toContain('"readWholeFile":true');
  expect(result.output).toContain('"brokenAnchors":["#missing"]');
  expect(result.output).toContain("Git步骤");
  expect((await runRoundtripEvidence(project, testCase)).verificationStatus).toBe("verified");
});

it("reports actual incomplete source tags even though DOMParser silently creates them", () => {
  const { project, testCase } = fixture();
  project.sourceArtifacts[0].textContent = "<html><body>truncated";
  const result = htmlFileEvidence(project, testCase)!;
  expect(result.output).toContain("源文件缺少完整 body 标签");
  expect(result.output).toContain("源文件缺少完整 head 标签");
});

it("supplies actual HTML content to semantic review without asking an executor to simulate document behavior", async () => {
  const { project, testCase } = fixture();
  project.acceptanceRubric = [AcceptanceCriterionSchema.parse({ id: "GIT", title: "Git步骤", requirement: "包含创建仓库步骤", validationMethod: "semantic-judge" })];
  const result = await artifactTargetAdapter.run({ project, testCase: { ...testCase, executionMode: "artifact-runtime", criterionIds: ["GIT"] } });
  expect(result.verificationStatus).toBe("verified");
  expect(result.cost).toBe(0);
  expect(result.output).toContain("创建仓库");
});
