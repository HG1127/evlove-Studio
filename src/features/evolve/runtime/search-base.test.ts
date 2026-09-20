import { describe, expect, it } from "vitest";
import type { EvolveProject, SourceArtifact } from "../schemas";
import { CandidateSchema } from "../schemas";
import { composeCandidateOnSearchChampion, projectAtSearchChampion, searchBaseCandidate } from "./search-base";

function trustedProject(source: SourceArtifact, parentContent: string): EvolveProject {
  const parent = CandidateSchema.parse({
    id: "parent",
    name: "parent",
    change: "accepted parent",
    patches: [],
    artifactSnapshots: [{ id: "parent-snapshot", sourceArtifactId: source.id, name: source.name, mimeType: source.mimeType, content: parentContent, buildMode: "deterministic", notes: [], createdAt: "2026-09-01T00:00:00.000Z" }],
  });
  return {
    version: "V1",
    sourceArtifacts: [source],
    searchChampion: {
      id: "champion-1", versionLabel: "S1", round: 1, score: 90, candidate: parent, patches: [], reason: "accepted", selectedAt: "2026-09-01T00:00:00.000Z",
      validation: { id: "validation-1", status: "completed", candidateId: parent.id, runs: [], baselineRuns: [], checks: [], recommendation: "release" },
      artifactAcceptance: { id: "accept-1", status: "passed", candidateId: parent.id, overallScore: 92, coverageScore: 95, integrityScore: 100, pairwiseScore: 90, hardGatePass: true, results: [], attempts: 0, maxRepairAttempts: 3, summary: "passed" },
    },
  } as unknown as EvolveProject;
}

describe("search-base · cumulative evolution", () => {
  it("uses only a fully validated champion as the next mutation base", () => {
    const source = { id: "a", name: "prompt.md", role: "target", artifactKind: "prompt", mimeType: "text/markdown", extension: "md", textContent: "V1" } as SourceArtifact;
    const project = trustedProject(source, "V2 accepted");
    expect(searchBaseCandidate(project)?.id).toBe("parent");
    expect(projectAtSearchChampion(project).sourceArtifacts[0]?.textContent).toBe("V2 accepted");
    const unsafe = { ...project, searchChampion: { ...project.searchChampion!, artifactAcceptance: { ...project.searchChampion!.artifactAcceptance!, status: "failed" as const } } };
    expect(searchBaseCandidate(unsafe)).toBeUndefined();
  });

  it("merges a code/package child delta with the accepted parent overlay", () => {
    const source = {
      id: "zip", name: "app.zip", role: "target", artifactKind: "codebase", mimeType: "application/zip", extension: "zip",
      artifactDescriptor: { family: "codebase", adapterId: "codebase-zip-repository" },
      structuredContent: { kind: "package", entries: [{ path: "src/a.ts", family: "code", content: "A1" }, { path: "src/b.ts", family: "code", content: "B1" }] },
      structure: ["src/a.ts", "src/b.ts"],
    } as unknown as SourceArtifact;
    const project = trustedProject(source, JSON.stringify({ kind: "codebase", overlay: true, files: [{ path: "src/a.ts", content: "A2" }] }));
    const active = projectAtSearchChampion(project);
    const entries = (active.sourceArtifacts[0]?.structuredContent as { entries: Array<{ path: string; content: string }> }).entries;
    expect(entries.find((item) => item.path === "src/a.ts")?.content).toBe("A2");
    expect(entries.find((item) => item.path === "src/b.ts")?.content).toBe("B1");

    const child = CandidateSchema.parse({
      id: "child", name: "child", change: "B2", patches: [],
      artifactSnapshots: [{ id: "child-snapshot", sourceArtifactId: "zip", name: "app.zip", mimeType: "application/zip", content: JSON.stringify({ kind: "codebase", overlay: true, files: [{ path: "src/b.ts", content: "B2" }] }), buildMode: "deterministic", notes: [], createdAt: "2026-09-02T00:00:00.000Z" }],
    });
    const cumulative = composeCandidateOnSearchChampion(project, child);
    const files = (JSON.parse(cumulative.artifactSnapshots[0]!.content) as { files: Array<{ path: string; content: string }> }).files;
    expect(files).toEqual(expect.arrayContaining([{ path: "src/a.ts", content: "A2" }, { path: "src/b.ts", content: "B2" }]));
    expect(cumulative.artifactBuildSummary).toContain("S1");
  });
});
