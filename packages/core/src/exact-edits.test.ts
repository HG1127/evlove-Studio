import { describe, expect, it } from "vitest";
import { TextArtifactEditsSchema, CandidatePatchSchema } from "@evolution/contracts";
import { applyExactEdits, buildExactCandidateTextEdits } from "./exact-edits";

const blueprint = (edits: unknown[]) => JSON.stringify({kind: "text-edits", edits});
describe("source-grounded exact text edits", () => {
  it("preserves all untouched Unicode and line endings in a large file", () => {
    const source = "头部\r\n" + "未修改原文".repeat(50000) + "唯一完整目标\r\n尾部";
    const result = applyExactEdits(source, blueprint([{before: "唯一完整目标", after: "真实修改结果"}]), {strict: true});
    expect(result).toBe(source.replace("唯一完整目标", "真实修改结果"));
  });
  it("supports exact offsets and normalized line endings without changing outside bytes", () => {
    const source = "unchanged\r\nunique\r\nblock\r\ntail";
    const start = source.indexOf("unique");
    expect(applyExactEdits(source, blueprint([{start, end: start + 13, before: "unique\nblock", after: "updated"}]), {strict: true})).toBe("unchanged\r\nupdated\r\ntail");
  });
  it.each([
    [{before: "missing", after: "new"}],
    [{before: "aa", after: "new"}],
    [{before: "aab", after: "new"}, {before: "abc", after: "other"}],
    [{before: "aaa", after: undefined}],
    [{before: "aaa", after: "new", start: 0.5}],
  ].map((edits) => ({edits})))("refuses ambiguous, overlapping or malformed model edits", ({edits}) => {
    expect(() => applyExactEdits("aaabc", blueprint(edits), {strict: true})).toThrow();
  });
  it("refuses guessed document and stylesheet anchors in strict mode", () => {
    const source = "<html><head><style>body { color: red; }</style></head><body>protected</body></html>";
    expect(() => applyExactEdits(source, blueprint([{before: "<html><body>imagined</body></html>", after: "<html><body>different</body></html>"}]), {strict: true})).toThrow();
    expect(() => applyExactEdits(source, blueprint([{before: "body{color:blue;}", after: "body{color:black;}"}]), {strict: true})).toThrow();
    const before = "body { color: red; }";
    expect(applyExactEdits(source, blueprint([{before, after: "body { color: black; }"}]), {strict: true})).toBe(source.replace(before, "body { color: black; }"));
  });
  it("identifies an invalid construction anchor without changing strict matching",()=>{
    try{applyExactEdits("actual parent",blueprint([{before:"invented",after:"change"}]),{strict:true});throw Error("must reject");}
    catch(error){expect(error).toMatchObject({code:"TEXT_EDIT_ANCHOR_INVALID",editIndex:0});}
  });
  it("retains the explicit legacy recovery behavior in the compatibility API", () => {
    const source = "<html><body>old</body></html>";
    const after = "<html><body>new</body></html>";
    expect(applyExactEdits(source, blueprint([{before: "<html lang='en'><body>old</body></html>", after}]))).toBe(after);
    expect(TextArtifactEditsSchema.safeParse({kind: "text-edits", edits: []}).success).toBe(false);
  });
});


describe("exact planned Candidate mutations", () => {
  const patch = (target: string, content: string, extra = {}) => CandidatePatchSchema.parse({id: target, component: "code", operation: "update", target, content, rationale: "planned exact change", ...extra});
  it("applies all planned updates and removals against the complete original", () => {
    const original = "unchanged\r\n中文 anchor\r\nremove block\r\nuntouched";
    const payload = buildExactCandidateTextEdits(original, [patch("中文 anchor", "中文 result"), patch("remove block", "", {operation: "remove"})]);
    expect(payload).toBeDefined();
    expect(applyExactEdits(original, payload!, {strict: true})).toBe("unchanged\r\n中文 result\r\n\r\nuntouched");
  });
  it.each([
    {source: "duplicate duplicate", patches: [patch("duplicate", "new")]},
    {source: "current", patches: [patch("absent", "new")]},
    {source: "aaabc", patches: [patch("aab", "new"), patch("abc", "other")]},
    {source: "current", patches: [patch("current", "current")]},
    {source: "current", patches: [patch("current", "new", {operation: "add"})]},
    {source: "current", patches: [patch("current", "new", {component: "tool"})]},
    {source: "first second", patches: [patch("first", "new", {id: "same"}), patch("second", "other", {id: "same"})]},
    {source: "body { color: red; }", patches: [patch("body{color:blue;}", "body{color:black;}")]},
  ])("leaves unsupported or ungrounded plans to the normal builder ($source)", ({source, patches}) => {
    expect(buildExactCandidateTextEdits(source, patches)).toBeUndefined();
  });
});
