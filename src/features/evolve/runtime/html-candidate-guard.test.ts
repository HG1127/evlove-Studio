import { expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { EvolveProjectSchema, SourceArtifactSchema, CandidateArtifactSnapshotSchema } from "../schemas";
import { htmlCandidateGuard } from "./html-candidate-guard";

const fixture = () => {
  const project = EvolveProjectSchema.parse(structuredClone(demoProject));
  const content = '<html><head></head><body><article id="slide-51"><h2>Git</h2><p>原有步骤</p></article><article id="slide-52"><h2>命令</h2><p>原有命令</p></article><article id="slide-56"><h2>Push</h2></article></body></html>';
  project.sourceArtifacts = [SourceArtifactSchema.parse({ ...project.sourceArtifacts[0], id: "html", role: "target", extension: "html", mimeType: "text/html", textContent: content })];
  project.protectedItems = ["保留 slide-51/52 原有标题、内容与结构"];
  const snapshot = CandidateArtifactSnapshotSchema.parse({ id: "snap", sourceArtifactId: "html", name: "test.html", mimeType: "text/html", content, contentHash: "test", buildMode: "deterministic", createdAt: "now" });
  return { project, snapshot };
};
it("confirms protected sections from complete files while allowing an additive new slide", () => {
  const { project, snapshot } = fixture();
  snapshot.content = snapshot.content.replace("</body>", '<article id="slide-56b"><h2>边界场景</h2></article></body>');
  const [result] = htmlCandidateGuard(project, [snapshot]);
  expect(result.issues).toEqual([]);
  expect(result.protectedSections.map((section) => section.id)).toEqual(["slide-51", "slide-52"]);
  expect(result.protectedSections.every((section) => section.textRetained)).toBe(true);
});
it("blocks actual protected content loss and newly repeated IDs before evaluating", () => {
  const { project, snapshot } = fixture();
  snapshot.content = snapshot.content.replace("原有步骤", "删改后的说明").replace("</body>", '<article id="slide-56">重复卡片</article></body>');
  const [result] = htmlCandidateGuard(project, [snapshot]);
  expect(result.newDuplicateIds).toEqual(["slide-56"]);
  expect(result.issues.join(" ")).toContain("slide-51");
});
it("does not fabricate proof for a protection scope missing from the original", () => {
  const { project, snapshot } = fixture();
  project.protectedItems = ["保护 slide-99"];
  const [result] = htmlCandidateGuard(project, [snapshot]);
  expect(result.unresolvedProtectedIds).toEqual(["slide-99"]);
  expect(result.protectedSections).toEqual([]);
});
