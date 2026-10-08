import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "../data/mock-project";
import { AcceptanceCriterionSchema, CandidateSchema, EvolveProjectSchema } from "../schemas";
import { runEvolveAi } from "../ai/service";
import { repairCandidateArtifacts } from "./candidate-repair";
vi.mock("../ai/service", () => ({ runEvolveAi: vi.fn() }));

function fixture() {
  const project = EvolveProjectSchema.parse(structuredClone(demoProject));
  const original = { ...project.sourceArtifacts[0]!, id: "html", role: "target" as const, name: "guide.html", extension: "html", mimeType: "text/html", artifactKind: "document" as const,
    textContent: '<!doctype html><html><head><style>body{color:navy}</style></head><body><section id="flow">旧流程</section><p>原始内容</p></body></html>' };
  const retained = { ...original, id: "readme", name: "readme.txt", extension: "txt", mimeType: "text/plain", textContent: "原始说明" };
  project.sourceArtifacts = [original, retained];
  project.protectedItems = [];
  project.aiProfile = { mode: "project", primary: { connectionId: "minimax", model: "project-repair-model", label: "修复模型" }, operationRoutes: {} };
  const candidate = CandidateSchema.parse({ id: "current", name: "新版", change: "完善流程", artifactBuildStatus: "ready", artifactSnapshots: [
    { id: "current-html", sourceArtifactId: original.id, name: original.name, mimeType: original.mimeType, content: original.textContent.replace("旧流程", "当前流程").replace("原始内容", "上轮已优化内容"), contentHash: "old-hash", createdAt: "now" },
    { id: "current-readme", sourceArtifactId: retained.id, name: retained.name, mimeType: retained.mimeType, content: "上轮已更新说明", createdAt: "now" },
  ] });
  const criterion = AcceptanceCriterionSchema.parse({ id: "flow", title: "流程闭环", requirement: "补齐下一步", validationMethod: "static-structure" });
  project.acceptanceRubric = [criterion];
  const acceptance = { ...project.artifactAcceptance, status: "failed" as const, results: [{ criterionId: criterion.id, score: 50, pass: false, evidence: ["下一步缺失"], gaps: ["补齐下一步"], note: "已证实失败" }] };
  return { project, candidate, acceptance, criterion };
}
const edit = (content: string, sourceArtifactId = "html") => ({ artifacts: [{ sourceArtifactId, name: "guide.html", mimeType: "text/html", content, notes: [] }], summary: "补齐下一步" });
beforeEach(() => vi.clearAllMocks());

describe("candidate repair on the current artifact", () => {
  it("applies a short HTML edit to the current snapshot, preserves other files and forwards project routing", async () => {
    const { project, candidate, acceptance, criterion } = fixture();
    vi.mocked(runEvolveAi).mockResolvedValue(edit(JSON.stringify({ kind: "html-edits", edits: [{ targetId: "flow", operation: "append", content: "<p>下一步：验证交付</p>" }] })));
    const repaired = await repairCandidateArtifacts(project, candidate, acceptance, [criterion]);
    expect(repaired.id).toBe(candidate.id);
    expect(repaired.artifactSnapshots[0]!.content).toBe(candidate.artifactSnapshots[0]!.content.replace("</section>", "<p>下一步：验证交付</p></section>"));
    expect(repaired.artifactSnapshots[1]!.content).toBe("上轮已更新说明");
    expect(repaired.artifactSnapshots[0]!.id).not.toBe(candidate.artifactSnapshots[0]!.id);
    expect(repaired.artifactSnapshots[0]!.contentHash).not.toBe("old-hash");
    expect(repaired.artifactSnapshots[0]!.frozenArtifact).toBeUndefined();
    expect(runEvolveAi).toHaveBeenCalledWith("repair-artifact", expect.objectContaining({ project: expect.objectContaining({ aiProfile: project.aiProfile }) }));
    expect(candidate.artifactSnapshots[0]!.content).not.toContain("验证交付");
  });

  it("bounds long text input and reconstructs edits without losing untouched bytes", async () => {
    const { project, candidate, acceptance, criterion } = fixture();
    const content = `${"未修改段落。".repeat(9000)}唯一缺失项${"尾部保护。".repeat(1000)}`;
    candidate.artifactSnapshots[1]!.content = content;
    vi.mocked(runEvolveAi).mockResolvedValue(edit(JSON.stringify({ kind: "text-edits", edits: [{ before: "唯一缺失项", after: "完整下一步" }] }), "readme"));
    const repaired = await repairCandidateArtifacts(project, candidate, acceptance, [criterion]);
    expect(repaired.artifactSnapshots[1]!.content).toBe(content.replace("唯一缺失项", "完整下一步"));
    const payload = vi.mocked(runEvolveAi).mock.calls[0]![1] as { artifacts: Array<{ sourceArtifactId: string; content?: string; context?: string; length: number }> };
    const bounded = payload.artifacts.find((item) => item.sourceArtifactId === "readme")!;
    expect(bounded.content).toBeUndefined();
    expect(bounded.context!.length).toBeLessThan(19000);
    expect(bounded.length).toBe(content.length);
  });

  it("rejects an unknown source identity and ambiguous edit instead of replacing an unrelated artifact", async () => {
    const { project, candidate, acceptance, criterion } = fixture();
    vi.mocked(runEvolveAi).mockResolvedValue(edit("fabricated", "unknown"));
    await expect(repairCandidateArtifacts(project, candidate, acceptance, [criterion])).rejects.toThrow("未知进化对象");
    candidate.artifactSnapshots[1]!.content = "重复重复";
    vi.mocked(runEvolveAi).mockResolvedValue(edit(JSON.stringify({ kind: "text-edits", edits: [{ before: "重复", after: "修改" }] }), "readme"));
    await expect(repairCandidateArtifacts(project, candidate, acceptance, [criterion])).rejects.toThrow();
    expect(candidate.artifactSnapshots[1]!.content).toBe("重复重复");
  });
});
