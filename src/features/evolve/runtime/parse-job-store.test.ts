import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceArtifact } from "../schemas";
import {
  beginParseJob,
  clearParseJobs,
  completeParseJob,
  createParseJob,
  discardParseJob,
  failParseJob,
  getParseJob,
  listParseJobs,
} from "./parse-job-store";

afterEach(async () => {
  await clearParseJobs();
  vi.unstubAllGlobals();
});

describe("persistent parse job lifecycle", () => {
  it("protects a newer parse generation from an older result", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const file = new File(["hello"], "brief.md", { type: "text/markdown", lastModified: 7 });
    await createParseJob({ id: "job-1", file, role: "target" });
    const first = await beginParseJob("job-1");
    const second = await beginParseJob("job-1");
    expect(first?.generation).toBe(1);
    expect(second?.generation).toBe(2);

    const artifact = {
      id: "artifact-new",
      name: "brief.md",
      role: "target",
      artifactKind: "document",
      mimeType: "text/markdown",
      size: 5,
      extension: "md",
      inputMode: "upload",
      parseStatus: "ready",
      structure: [],
      warnings: [],
      createdAt: new Date().toISOString(),
    } as SourceArtifact;

    expect(await completeParseJob("job-1", 1, artifact)).toBe(false);
    expect(await completeParseJob("job-1", 2, artifact)).toBe(true);
    expect((await getParseJob("job-1"))?.artifact?.id).toBe("artifact-new");
  });

  it("keeps failed jobs retryable and removes discarded jobs", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const file = new File(["x"], "scan.pdf", { type: "application/pdf" });
    await createParseJob({ id: "job-2", file, role: "reference" });
    const run = await beginParseJob("job-2");
    expect(await failParseJob("job-2", run!.generation, "OCR unavailable")).toBe(true);
    expect((await listParseJobs())[0]?.status).toBe("error");
    await discardParseJob("job-2");
    expect(await getParseJob("job-2")).toBeUndefined();
  });
});
