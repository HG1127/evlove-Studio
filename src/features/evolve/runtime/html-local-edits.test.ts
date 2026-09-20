import { describe, it, expect } from "vitest";
import { applyHtmlLocalEdits } from "./html-local-edits";
const original = '<!doctype html><html><head></head><body><article id="slide-51">keep</article><article id="slide-56"><div>step six</div></article></body></html>';
const apply = (edits: unknown[]) => applyHtmlLocalEdits(original, JSON.stringify({kind:"html-edits",edits}));
describe("HTML 局部修改", () => {
 it("章节内前后插入，保留原文和唯一章节", () => {
  const result = apply([{targetId:"slide-56",operation:"prepend",content:"<p>说明</p>"},{targetId:"slide-56",operation:"append",content:"<p>git pull</p>"}]);
  expect(result).toBe(original.replace('<div>step six</div>', '<p>说明</p><div>step six</div><p>git pull</p>'));
 });
 it("拒绝重复章节外壳", () => expect(() => apply([{targetId:"slide-56",operation:"append",content:'<article id="slide-56">new</article>'}])).toThrow(/重复 ID/));
 it("拒绝不存在的目标", () => expect(() => apply([{targetId:"missing",operation:"append",content:"text"}])).toThrow(/缺失或重复/));
 it("拒绝嵌套重叠替换", () => expect(() => apply([{targetId:"slide-56",operation:"replace",content:'<article id="slide-56"></article>'},{targetId:"slide-56",operation:"append",content:"text"}])).toThrow(/重叠/));
 it("同一点的多次插入保持顺序", () => expect(apply([{targetId:"slide-56",operation:"append",content:"a"},{targetId:"slide-56",operation:"append",content:"b"}])).toContain('</div>ab</article>'));
});
