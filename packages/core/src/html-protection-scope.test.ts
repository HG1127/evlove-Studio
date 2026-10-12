import { describe, expect, it } from "vitest";
import { AcceptanceCriterionSchema, SourceArtifactSchema, type EvolveProject } from "@evolution/contracts";
import { hasHtmlProtectionTarget, htmlProtectionAcceptanceBlocker, htmlProtectionCoverageGap, isWholeProtectionCriterion } from "./html-protection-scope";
const criterion = (extra: Record<string, unknown> = {}) => AcceptanceCriterionSchema.parse({ id: "C", title: "Narrow", requirement: "Search label is Find", ...extra });
const artifact = (extra: Record<string, unknown> = {}) => SourceArtifactSchema.parse({ id: "A", name: "source.txt", extension: "txt", role: "target", createdAt: "2026-10-13T00:00:00Z", ...extra });
const project = (sourceArtifacts: EvolveProject["sourceArtifacts"], acceptanceRubric: EvolveProject["acceptanceRubric"]) => ({ sourceArtifacts, acceptanceRubric, evalSuite: [], hiddenEvalSuite: [] }) as unknown as EvolveProject;

describe("complete HTML protection policy", () => {
  it.each(["PROTECT-ALL", "SYS-INTEGRITY"])("recognizes canonical %s despite altered method/metadata", id => {
    expect(isWholeProtectionCriterion(criterion({ id, hardGate: false, validationMethod: "format-roundtrip" }))).toBe(true);
    expect(htmlProtectionCoverageGap(criterion({ id }))).toContain("scope-pending");
  });
  it.each([{ source: "protected-item" }, { protectedConstraint: true }, { requirement: "全部保留原有内容与交互" }, { requirement: "Preserve all original behaviors" }])("recognizes declared protection %j", extra => {
    expect(isWholeProtectionCriterion(criterion(extra))).toBe(true);
  });
  it.each([{ category: "protected", requirement: "Full artifact integrity" }, { category: "integrity", requirement: "Complete artifact integrity" }, { judgeType: "integrity", requirement: "Preserve the whole original artifact" }])("retains custom whole-scope declarations despite a format route %j", extra => {
    expect(isWholeProtectionCriterion(criterion({ id: "FORMAT", validationMethod: "format-roundtrip", ...extra }))).toBe(true);
  });
  it("keeps narrow non-protection and actual format-only criteria outside whole scope", () => {
    expect(isWholeProtectionCriterion(criterion())).toBe(false);
    expect(isWholeProtectionCriterion(criterion({ id: "FORMAT", protectedConstraint: true, category: "integrity", judgeType: "integrity", validationMethod: "format-roundtrip", requirement: "Markdown 可往返" }))).toBe(false);
    expect(isWholeProtectionCriterion(criterion({ id: "FORMAT", validationMethod: "format-roundtrip", requirement: "Preserve file format" }))).toBe(false);
    expect(isWholeProtectionCriterion(criterion({ id: "FORMAT", validationMethod: "format-roundtrip", requirement: "Preserve all original content" }))).toBe(true);
  });
  it.each([{ extension: "html" }, { name: "source.HTM" }, { mimeType: "text/html; charset=utf-8" }, { textContent: "<html><script>/* static only */</script></html>" }])("recognizes HTML without depending on one metadata field %j", extra => {
    expect(hasHtmlProtectionTarget({ sourceArtifacts: [artifact(extra)] })).toBe(true);
  });
  it("does not turn unknown/empty source metadata into a non-HTML exemption", () => {
    expect(hasHtmlProtectionTarget()).toBeUndefined();
    expect(hasHtmlProtectionTarget({ sourceArtifacts: [] })).toBeUndefined();
    for (const extension of ["", "bin", "unknown"]) {
      const unknown = artifact({ extension, name: "a." + extension, mimeType: "application/octet-stream", textContent: undefined });
      expect(hasHtmlProtectionTarget({ sourceArtifacts: [unknown] })).toBeUndefined();
      expect(htmlProtectionAcceptanceBlocker(project([unknown], [criterion({ id: "PROTECT-ALL" })]))).toContain("scope-pending");
    }
    expect(htmlProtectionAcceptanceBlocker(project([], [criterion({ id: "PROTECT-ALL" })]))).toContain("scope-pending");
    const unknownMime = artifact({ extension: "mystery", name: "source.dat", mimeType: "application/x-mystery", textContent: undefined });
    expect(hasHtmlProtectionTarget({ sourceArtifacts: [unknownMime] })).toBeUndefined();
    expect(htmlProtectionCoverageGap(criterion({ id: "SYS-INTEGRITY" }), { sourceArtifacts: [] })).toContain("scope-pending");
  });
  it("preserves known non-HTML evaluation behavior", () => {
    expect(htmlProtectionCoverageGap(criterion({ id: "SYS-INTEGRITY" }), { sourceArtifacts: [artifact()] })).toBeUndefined();
    expect(htmlProtectionAcceptanceBlocker(project([artifact()], [criterion({ id: "SYS-INTEGRITY" })]))).toBeUndefined();
  });
  it("blocks acceptance independently of tags and transport proof but permits an unrelated HTML rubric", () => {
    const html = artifact({ extension: "html" });
    expect(htmlProtectionAcceptanceBlocker(project([html], [criterion({ id: "PROTECT-ALL" })]))).toContain("scope-pending");
    expect(htmlProtectionAcceptanceBlocker(project([html], []))).toBeUndefined();
    expect(htmlProtectionAcceptanceBlocker(project([html], [criterion()]))).toBeUndefined();
  });
});
