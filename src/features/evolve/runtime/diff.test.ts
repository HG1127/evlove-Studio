import { describe, expect, it } from "vitest";
import { compactDiffLines, diffLines, projectFullDiffSides } from "./diff";

describe("difference-first version comparison", () => {
  it("collapses long unchanged runs while keeping changes and nearby context", () => {
    const oldLines = ["same-1", "same-2", "same-3", "old-value", "same-4", "same-5", "same-6"];
    const newLines = ["same-1", "same-2", "same-3", "new-value", "same-4", "same-5", "same-6"];
    const diff = diffLines(oldLines, newLines);
    const compact = compactDiffLines(diff.lines, 1);

    expect(compact.some((item) => item.type === "del" && item.text === "old-value")).toBe(true);
    expect(compact.some((item) => item.type === "add" && item.text === "new-value")).toBe(true);
    expect(compact.some((item) => item.type === "skip" && item.count > 0)).toBe(true);
    expect(compact.filter((item) => item.type === "same").length).toBeLessThan(6);
  });

  it("projects full compare as the two real documents without synthetic blank placeholders", () => {
    const oldLines = ["工作流程总结:", "旧步骤 A", "旧步骤 B", "共同结尾"];
    const newLines = ["工作流程总结:", "新步骤 A", "新步骤 B", "新步骤 C", "共同结尾"];
    const sides = projectFullDiffSides(diffLines(oldLines, newLines).lines);

    expect(sides.left.map((line) => line.text)).toEqual(oldLines);
    expect(sides.right.map((line) => line.text)).toEqual(newLines);
    expect(sides.left.some((line) => line.text === "")).toBe(false);
    expect(sides.right.some((line) => line.text === "")).toBe(false);
    expect(sides.right.find((line) => line.text === "新步骤 A")?.kind).toBe("add");
  });

  it("represents identical documents as one collapsed unchanged marker", () => {
    const diff = diffLines(["a", "b", "c"], ["a", "b", "c"]);
    expect(compactDiffLines(diff.lines, 1)).toEqual([{ type: "skip", count: 3 }]);
  });
});
