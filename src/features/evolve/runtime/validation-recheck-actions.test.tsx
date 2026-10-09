// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validate: vi.fn(), loop: vi.fn(), save: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(), runValidation: mocks.validate,
}));
vi.mock("./artifact-loop", async (importOriginal) => ({
  ...await importOriginal<typeof import("./artifact-loop")>(), repairValidationCheckpoint: () => undefined,
  runArtifactAcceptanceLoop: mocks.loop,
}));
vi.mock("./local-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("./local-store")>(), getLocalProject: () => undefined, saveLocalProject: mocks.save,
}));
vi.mock("./automatic-evidence", () => ({ automaticEvidenceKey: () => "synthetic-only", ensureAutomaticEvidence: async () => ({}) }));
import { demoProject } from "../data/mock-project";
import { CandidateSchema, type EvolveProject } from "../schemas";
import { useProjectRuntime, type ProjectRuntime } from "./use-project-runtime";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, runtime: ProjectRuntime;
const candidate = CandidateSchema.parse({ id: "fresh-judge-action", name: "Synthetic candidate", change: "Synthetic change" });
function Harness({ project }: { project: EvolveProject }) {
  const current = useProjectRuntime(project);
  useEffect(() => { runtime = current; }, [current]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear(); mocks.validate.mockReset(); mocks.loop.mockReset(); mocks.save.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mocks.validate.mockResolvedValue({ ...demoProject.validationRun, status: "completed", candidateId: candidate.id, recommendation: "hold" });
  mocks.loop.mockImplementation(async ({ project, validation }: { project: EvolveProject; validation: EvolveProject["validationRun"] }) => ({
    candidate, validation, rubric: project.acceptanceRubric, acceptance: { ...project.artifactAcceptance, status: "unverified" }, repaired: false,
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.localStorage.clear(); vi.unstubAllGlobals(); });
async function render() {
  const project: EvolveProject = { ...structuredClone(demoProject), id: "synthetic-actions", candidates: [candidate],
    experimentRun: { ...demoProject.experimentRun, status: "completed", winnerId: candidate.id } };
  await act(async () => root.render(<Harness project={project} />));
}
it("explicit revalidation asks for fresh model judgement", async () => {
  await render(); await act(async () => { await runtime.executeValidation(); });
  expect(mocks.validate).toHaveBeenCalledWith(expect.anything(), candidate, expect.any(Function), { forceJudgeRefresh: true });
  expect(mocks.loop).toHaveBeenCalledTimes(1);
});
it("failed-case retry also asks for fresh judging of both merged answer sheets", async () => {
  await render(); await act(async () => { await runtime.retryFailedValidation(); });
  expect(mocks.validate).toHaveBeenCalledWith(expect.anything(), candidate, expect.any(Function),
    { retryFailedOnly: true, forceJudgeRefresh: true });
});
it("model configuration failure keeps delivery gates blocked", async () => {
  await render(); mocks.validate.mockRejectedValue(new Error("No live model configured"));
  await act(async () => { await runtime.executeValidation(); });
  expect(mocks.loop).not.toHaveBeenCalled();
  expect(runtime.project.validationRun.status).toBe("failed");
  expect(runtime.project.artifactAcceptance.status).toBe("unverified");
  expect(runtime.project.gates.filter((gate) => gate.id === "artifact-ready" || gate.id === "release-ready")
    .every((gate) => gate.status === "blocked")).toBe(true);
});
