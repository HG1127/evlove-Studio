import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { SourceArtifactSchema, ProblemSchema } from "../schemas";
import { baselineRubricProblem, buildFocusedPlanPayload, focusedSourceContext, prioritizeProblems, limitPlanToTask } from "./focused-task";
import { PlanAiResultSchema } from "../ai/schemas";
import { runDemoAi } from "../ai/demo-provider";

describe("focused evolution", () => {
  it("keeps source text within one shared budget and finds evidence in late artifacts", () => {
    const project = { ...demoProject, sourceArtifacts: Array.from({ length: 12 }, (_, i) => SourceArtifactSchema.parse({
      id: `s${i}`, name: `file${i}.md`, role: "target", artifactKind: "document", mimeType: "text/markdown",
      size: 20000, extension: "md", inputMode: "paste", parseStatus: "ready", createdAt: "t",
      textContent: "普通背景。".repeat(4000) + (i === 11 ? "导航定位故障。".repeat(150) : ""),
    })) };
    const original = project.sourceArtifacts[11]!.textContent;
    const result = focusedSourceContext(project, "导航定位故障", 6000);
    expect(result.sources.some(s => s.id === "s11")).toBe(true);
    expect(result.sources.reduce((n, s) => n + s.textContent.length, 0)).toBeLessThanOrEqual(6000);
    expect(result.omittedArtifactIds.length).toBe(6);
    expect(project.sourceArtifacts[11]!.textContent).toBe(original);
  });

  it("does not send historical full artifacts through plan extras", () => {
    const payload = buildFocusedPlanPayload(demoProject, { archive: "HUGE ARCHIVE", project: { sourceArtifacts: ["HUGE SOURCE"] } });
    expect(payload.candidateCount).toBe(2);
    expect(JSON.stringify(payload)).not.toContain("HUGE");
    expect(payload.project.protectedItems).toEqual(demoProject.protectedItems);
  });

  it("preserves compact champion/parent-pool search context instead of dropping it", () => {
    const champion = { id: "champion-1", versionLabel: "S3", round: 3, score: 91, patches: [{ id: "p", component: "prompt", operation: "add", target: "Evidence", content: "gate", rationale: "r" }], reason: "best" };
    const payload = buildFocusedPlanPayload(demoProject, {
      searchChampion: champion,
      parentPool: [{ source: "search-champion", id: "champion-1", label: "S3", round: 3, score: 91, niche: "prompt", patches: champion.patches, reason: "best", artifactSnapshots: ["MUST_NOT_LEAK"] }],
      archive: [{ id: "a", round: 2, kind: "elite", niche: "workflow", score: 88, candidate: { id: "elite", patches: champion.patches, artifactSnapshots: ["MUST_NOT_LEAK"] }, reason: "elite" }],
      parentStrategy: "champion-elites",
      exploreRatio: 0.42,
    });
    expect(payload.search.baseVersionId).toBe("S3");
    expect(payload.search.parentPool[0]?.id).toBe("champion-1");
    expect(payload.search.recentArchive[0]?.candidateId).toBe("elite");
    expect(payload.search.exploreRatio).toBe(0.42);
    expect(JSON.stringify(payload.search)).not.toContain("MUST_NOT_LEAK");
  });

  it("keeps the target present even when references rank higher", () => {
    const base = SourceArtifactSchema.parse({ id: "target", name: "main.md", role: "target", artifactKind: "document", mimeType: "text/markdown", size: 10, extension: "md", inputMode: "paste", parseStatus: "ready", createdAt: "t", textContent: "原始成果" });
    const project = { ...demoProject, sourceArtifacts: [base, ...Array.from({ length: 8 }, (_, i) => ({ ...base, id: `ref${i}`, role: "reference" as const, textContent: "导航定位故障" }))] };
    const result = focusedSourceContext(project, "导航定位故障");
    expect(result.sources.some(source => source.id === "target")).toBe(true);
    expect(result.omittedArtifactIds).not.toContain("target");
    expect(result.sources.length + result.omittedArtifactIds.length).toBe(9);
  });

  it("ranks evidence-backed problems ahead of unsupported high-impact guesses", () => {
    const make = (id: string, evidence: string[], confidence: number) => ProblemSchema.parse({ id, title: id, summary: id, impact: 100, severity: "high", status: "observing", evidence, confidence });
    expect(prioritizeProblems([make("guess", [], 0.2), make("proven", ["source"], 0.9)])[0]!.problem.id).toBe("proven");
  });

  it("promotes a verified Rubric failure directly instead of paying for broad problem discovery", () => {
    const criterion = { ...demoProject.acceptanceRubric[0]!, id: "REQ-SPEED", title: "核心目标", minScore: 90, weight: 40, hardGate: true };
    const p = {
      ...demoProject,
      acceptanceRubric: [criterion],
      baselineRun: { ...demoProject.baselineRun, result: { ...demoProject.baselineRun.result!, criterionScores: [{ criterionId: criterion.id, score: 62, pass: false, verificationStatus: "verified" as const, evidence: ["当前成果缺少闭环"], gaps: ["缺少自动验收"], testCaseIds: ["t1"] }] } },
    };
    const problem = baselineRubricProblem(p);
    expect(problem?.title).toContain("核心目标");
    expect(problem?.evidence).toContain("当前成果缺少闭环");
    expect(problem?.confidence).toBeGreaterThan(0.9);
  });

  it("keeps a compact two-candidate search within the focused plan contract", () => {
    const result = PlanAiResultSchema.parse(runDemoAi("plan", {}));
    expect(PlanAiResultSchema.safeParse({ ...result, candidates: result.candidates.slice(0, 1), recommendedCandidateIds: [result.candidates[0]!.id] }).success).toBe(true);
    expect(limitPlanToTask(demoProject, result).candidates).toHaveLength(2);
    const exploratory = { ...demoProject, campaign: { ...demoProject.campaign, searchMode: "explore" as const, candidateCount: 2 } };
    expect(limitPlanToTask(exploratory, result).candidates).toHaveLength(2);
  });
});
