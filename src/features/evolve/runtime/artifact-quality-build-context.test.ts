import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoProject } from "../data/mock-project";
import { CandidateSchema, type EvolveProject } from "../schemas";
import { runEvolveAi } from "../ai/service";
import { buildCandidateArtifacts } from "./artifact-quality";

vi.mock("../ai/service", () => ({ runEvolveAi: vi.fn() }));

const rejected = vi.mocked(runEvolveAi);

function projectWithHtml(length: number): EvolveProject {
  const source = `<html><head><title>Guide</title></head><body><main id="guide">${"Existing guide content. ".repeat(Math.ceil(length / 24))}</main></body></html>`;
  return {
    ...demoProject,
    objectType: "document",
    sourceArtifacts: [{
      ...demoProject.sourceArtifacts[0]!, id: "html-target", name: "guide.html", mimeType: "text/html", extension: "html",
      artifactKind: "document", textContent: source, textExcerpt: source.slice(0, 300), size: source.length,
    }],
    artifactGraph: { nodes: [], edges: [], summary: "duplicate metadata ".repeat(1000), generatedAt: "2026-09-01T00:00:00.000Z" },
  };
}

const candidate = CandidateSchema.parse({
  id: "html-slow", name: "HTML candidate", change: "Improve the guide",
  patches: [{ id: "p1", component: "prompt", operation: "update", target: "not an exact source block", content: "New guide section", rationale: "Make steps clearer" }],
});

describe("candidate builder context budget", () => {
  beforeEach(() => { rejected.mockReset().mockRejectedValue(new Error("stop before materialization")); });

  it("sends one bounded source excerpt for a large HTML target", async () => {
    await expect(buildCandidateArtifacts(projectWithHtml(40000), candidate)).rejects.toThrow("stop before materialization");
    const payload = rejected.mock.calls[0]?.[1] as { targetArtifacts: Array<{ context?: string; adaptiveContext: unknown }>; project: { artifactGraph?: unknown } };
    expect(payload.targetArtifacts[0]?.context).toBeUndefined();
    expect(JSON.stringify(payload.targetArtifacts[0]?.adaptiveContext).length).toBeLessThan(16000);
    expect(payload.project.artifactGraph).toBeUndefined();
  });

  it("keeps the richer context for a short HTML target", async () => {
    await expect(buildCandidateArtifacts(projectWithHtml(4000), candidate)).rejects.toThrow("stop before materialization");
    const payload = rejected.mock.calls[0]?.[1] as { targetArtifacts: Array<{ context?: string }>; project: { artifactGraph?: unknown } };
    expect(payload.targetArtifacts[0]?.context).toBeTruthy();
    expect(payload.project.artifactGraph).toBeDefined();
  });
});
