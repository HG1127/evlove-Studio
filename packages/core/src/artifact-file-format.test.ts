import { describe, expect, it } from "vitest";
import { hasSourceTextArtifactFileFormat } from "./artifact-file-format";

describe("text Artifact filename format", () => {
  it.each(["renamed.html", "nested/renamed.HTML", "renamed.htm"])("allows same-format rename %s", (name) => {
    expect(hasSourceTextArtifactFileFormat({ name: "original.html", extension: "html" }, name)).toBe(true);
  });
  it.each(["candidate.zip", "candidate.md", "candidate", "candidate.html.zip"])("rejects a different output format %s", (name) => {
    expect(hasSourceTextArtifactFileFormat({ name: "original.html", extension: "html" }, name)).toBe(false);
  });
  it("uses the original filename when a legacy text Source has no explicit extension", () => {
    expect(hasSourceTextArtifactFileFormat({ name: "original.html", extension: "" }, "renamed.zip")).toBe(false);
    expect(hasSourceTextArtifactFileFormat({ name: "original.html", extension: "" }, "renamed.html")).toBe(true);
  });
  it("accepts the HTML/HTM alias in both directions", () => {
    expect(hasSourceTextArtifactFileFormat({ name: "original.htm", extension: "HTM" }, "renamed.html")).toBe(true);
  });
  it("handles a missing legacy extension and original files without a dot", () => {
    expect(hasSourceTextArtifactFileFormat({ name: "original.html" }, "candidate.zip")).toBe(false);
    expect(hasSourceTextArtifactFileFormat({ name: "original.html" }, "candidate.HTML")).toBe(true);
    expect(hasSourceTextArtifactFileFormat({ name: "README", extension: "" }, "README-evolved")).toBe(true);
    expect(hasSourceTextArtifactFileFormat({ name: "original", extension: "html" }, "candidate")).toBe(false);
  });
  it("retains existing non-text materializer format rules", () => {
    expect(hasSourceTextArtifactFileFormat({ name: "original.docx", extension: "docx" }, "renamed.docx")).toBe(true);
  });
});
