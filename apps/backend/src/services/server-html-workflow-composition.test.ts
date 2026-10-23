// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, TestCaseSchema, type EvolveProject, type Candidate, type TargetRunResult, type TestCase } from "@evolution/contracts";
import { runServerMissionExperiment } from "./server-experiment";
import { runServerMissionHoldout } from "./server-holdout";
const { html } = vi.hoisted(() => ({ html: vi.fn() }));
vi.mock("@evolution/harness", async (importOriginal) => ({ ...await importOriginal<typeof import("@evolution/harness")>(), runServerExperiment: (_project: unknown, ports: unknown) => ports, runServerHoldout: (_project: unknown, ports: unknown) => ports }));
vi.mock("./server-html-artifact-execution", () => ({ runServerHtmlArtifactBatch: html, serverHtmlArtifactTargetEnabled: () => true }));
vi.mock("./server-http-target-execution", () => ({ serverHttpTargetEnabled: () => false }));
vi.mock("./connector-target-source", () => ({ serverConnectorTargetEnabled: () => false }));
const project = { id: "html-mission", sourceArtifacts: [{id:"html",role:"target",extension:"html"}], acceptanceRubric:[] } as unknown as EvolveProject;
const candidate = CandidateSchema.parse({ id: "tested-candidate", name: "HTML Candidate", change: "Improve HTML" });
const testCases = [TestCaseSchema.parse({ id: "H1", title: "Hidden behavior", input: "inspect", expected: ["actual"], hidden: true, executionMode: "external-runner", browserSteps: [{ action: "visible", selector: "#actual" }] })];
type CurrentPort = { executeExternalBatch: (args: { project: EvolveProject; testCases: TestCase[] }) => Promise<TargetRunResult[]> };
type CandidatePort = { executeExternalBatch: (args: { project: EvolveProject; candidate: Candidate; testCases: TestCase[] }) => Promise<TargetRunResult[]> };
beforeEach(() => { html.mockReset(); html.mockResolvedValue([{ testCaseId: "H1", output: "exact HTML", latencyMs: 1, cost: 0, verificationStatus: "verified", trace: [] }]); });
describe("standalone HTML Workflow composition", () => {
  it("passes the exact Candidate into the Experiment external port", async () => {
    const ports = await runServerMissionExperiment(project) as unknown as CandidatePort;
    await ports.executeExternalBatch({ project, candidate, testCases });
    expect(html).toHaveBeenCalledExactlyOnceWith(project, testCases, candidate);
  });
  it("keeps paired Hidden current-version and Candidate inputs separate on the same paper", async () => {
    const ports = await runServerMissionHoldout(project) as unknown as { current: CurrentPort; candidate: CandidatePort };
    await ports.current.executeExternalBatch({ project, testCases });
    await ports.candidate.executeExternalBatch({ project, candidate, testCases });
    expect(html.mock.calls).toEqual([[project, testCases], [project, testCases, candidate]]);
  });
});
