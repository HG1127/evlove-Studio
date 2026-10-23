import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ judge: vi.fn(), run: vi.fn() }));
vi.mock("../evaluation/service", async (importOriginal) => ({ ...await importOriginal<typeof import("../evaluation/service")>(), evaluateRuns: mocks.judge }));
vi.mock("../target/registry", () => ({ getTargetAdapter: () => ({ run: mocks.run }), getTargetStatus: () => ({ live: true, provider: "test" }) }));
import { demoProject } from "../data/mock-project";
import { AcceptanceCriterionSchema, CandidateSchema, TestCaseSchema } from "../schemas";
import { runValidation } from "./run-local";

it("revalidation requests a new candidate judgement even when the immutable artifact is unchanged", async () => {
  const criterion = AcceptanceCriterionSchema.parse({ id: "SOP", title: "配置步骤", requirement: "配置有完成检查", source: "user-command", hardGate: true, validationMethod: "semantic-judge" });
  const testCase = TestCaseSchema.parse({ id: "H-SOP", title: "步骤检查", input: "检查当前 SOP", expected: ["完成检查"], criterionIds: [criterion.id], hidden: true });
  const source = { ...demoProject.sourceArtifacts[0]!, id: "sop", name: "guide.md", artifactKind: "document" as const, extension: "md", textContent: "旧版配置说明" };
  const candidate = CandidateSchema.parse({ id: "same", name: "当前新版", change: "补充检查", artifactSnapshots: [{ id: "sop-current", sourceArtifactId: "sop", name: "guide.md", mimeType: "text/markdown", content: "填写配置后检查输出，异常时修正后重试。", createdAt: "2026-10-08T00:00:00Z" }] });
  const project = { ...demoProject, id: "revalidation-proof", objectType: "document" as const, evolutionCommand: "补充配置详情", sourceArtifacts: [source], acceptanceRubric: [criterion], hiddenEvalSuite: [testCase], candidates: [candidate], experimentRun: { ...demoProject.experimentRun, status: "completed" as const, winnerId: candidate.id } };
  mocks.run.mockImplementation(async ({testCase}: {testCase: {id: string}}) => ({ testCaseId: testCase.id, output: "当前文件观察", verificationStatus: "verified", latencyMs: 0, cost: 0, trace: [] }));
  mocks.judge.mockImplementation(async ({context}: {context: {project: {acceptanceRubric: typeof project.acceptanceRubric}}}) => ({ ...demoProject.baselineRun.result!, safety: "PASS", unverifiedCriterionIds: context.project.acceptanceRubric.map((item) => item.id), criterionScores: [] }));
  const first = await runValidation(project, candidate, undefined, {skipFastGate: true, forceJudgeRefresh: true});
  await runValidation({ ...project, validationRun: first }, candidate, undefined, {skipFastGate: true, forceJudgeRefresh: true});
  const candidateReviews = mocks.judge.mock.calls.map(([args]) => args).filter((args) => args.context.candidate);
  expect(candidateReviews).toHaveLength(2);
  expect(candidateReviews.every((args) => args.forceRefresh === true)).toBe(true);
  expect(candidateReviews[0].runs.map((run: {output: string}) => run.output)).toEqual(candidateReviews[1].runs.map((run: {output: string}) => run.output));
});