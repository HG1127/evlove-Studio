import { describe, expect, it } from "vitest";
import { EvolveProjectSchema } from "./schemas";
import { BuildCandidateAiResultSchema } from "./ai/schemas";
import { demoProject } from "./data/mock-project";
describe("EvolveProjectSchema", () => { it("accepts the canonical mock project", () => { expect(EvolveProjectSchema.parse(demoProject).id).toBe("demo"); }); });

describe("BuildCandidateAiResultSchema", () => {
  it("does not discard complete candidate artifacts only because summary metadata is omitted", () => {
    const parsed = BuildCandidateAiResultSchema.parse({
      artifacts: [{
        sourceArtifactId: "source-1", name: "result.txt", mimeType: "text/plain", content: "完整候选内容",
        contentHash: "hash-1", buildMode: "ai-full", notes: [],
      }],
    });
    expect(parsed.artifacts).toHaveLength(1);
    expect(parsed.summary).toMatch(/候选成果已生成/);
  });
});
