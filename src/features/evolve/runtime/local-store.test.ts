import { beforeEach, describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { CandidateSchema } from "../schemas";
import { deleteLocalProject, isDemoRemoved, listLocalProjects, markDemoRemoved, saveLocalProject } from "./local-store";

const KEY = "evolve-studio:projects:v2.2";
const LEGACY_KEY = "evolve-studio:projects:v0.5";

beforeEach(() => {
  window.localStorage.clear();
});

describe("local-store 删除与迁移", () => {
  it("当前存储从未创建时，做一次性历史迁移", () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([demoProject]));
    expect(listLocalProjects().map((p) => p.id)).toEqual([demoProject.id]);
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it("把项目删光后，历史版本键里的旧副本不得复活", () => {
    // 老版本数据先迁移进来，再模拟用户删掉最后一个项目
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([{ ...demoProject, id: "agent_riskos", name: "agent_riskos" }]));
    listLocalProjects();
    deleteLocalProject("agent_riskos");
    expect(window.localStorage.getItem(KEY)).toBe("[]");
    expect(listLocalProjects()).toEqual([]);
  });

  it("迁移只执行一次：当前存储损坏解析失败时也不回读历史键", () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify([demoProject]));
    listLocalProjects();
    window.localStorage.setItem(KEY, "{broken json");
    expect(listLocalProjects()).toEqual([]);
  });

  it("示例项目删除标记对所有入口生效", () => {
    expect(isDemoRemoved()).toBe(false);
    markDemoRemoved();
    expect(isDemoRemoved()).toBe(true);
  });

  it("旧存档缺少文件绑定：保留成果但不补造 Champion 或验收证据", () => {
    // 复刻修复前的存档形态：验收通过、验证建议 release、已冻结主成果物，但没有 searchChampion
    const winner = CandidateSchema.parse({ id: "C1", name: "补齐结构约束", change: "为 PRD 增加约束清单" });
    const evaluation = { accuracy: 92, evidence: 90, riskCoverage: 88, completeness: 91, safety: "PASS" as const, averageCost: 0.02, averageLatencyMs: 1200 };
    const project = {
      ...demoProject,
      id: "agent_riskos",
      candidates: [winner],
      experimentRun: { ...demoProject.experimentRun, status: "completed" as const, winnerId: winner.id },
      validationRun: { ...demoProject.validationRun, status: "completed" as const, candidateId: winner.id, evaluation, recommendation: "release" as const },
      artifactAcceptance: { ...demoProject.artifactAcceptance, status: "passed" as const, candidateId: winner.id, overallScore: 88, coverageScore: 90, integrityScore: 90, pairwiseScore: 85, hardGatePass: true, attempts: 1, summary: "Gate F 通过", acceptedAt: "2026-09-07T00:00:00.000Z" },
      outputArtifacts: [{ id: "accepted-primary-C1-0", projectId: "agent_riskos", round: 0, versionLabel: "V2", candidateId: winner.id, name: "evolved-prd.md", mimeType: "text/markdown", kind: "primary" as const, content: "# 奶茶店点单系统 PRD", description: "通过验收的 Candidate 快照", sourceArtifactIds: [], isChampion: true, accepted: true, createdAt: "2026-09-07T00:00:00.000Z" }],
    };
    window.localStorage.setItem(KEY, JSON.stringify([project]));
    const loaded = listLocalProjects()[0]!;
    // 成果中心 / 成果面板的展示门槛是「已登记最佳版本」，补登记后老项目也能进成果中心
    expect(loaded.searchChampion).toBeUndefined();
    expect(loaded.outputArtifacts.some((artifact) => artifact.kind === "primary")).toBe(true);
    expect(loaded.outputArtifacts.some((artifact) => artifact.kind === "manifest")).toBe(false);
    expect(loaded.outputArtifacts.every((artifact) => !artifact.accepted)).toBe(true);
    // 幂等：写回后再读，成果物不重复叠加
    saveLocalProject(loaded);
    const settled = listLocalProjects()[0]!;
    expect(settled.outputArtifacts.filter((artifact) => artifact.kind === "manifest").length).toBe(0);
  });
});
