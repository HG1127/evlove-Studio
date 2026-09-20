import { describe, expect, it } from "vitest";
import { retrieveTextContext } from "./context-retrieval";

describe("中文证据检索", () => {
  it("两块预算仍召回中间关键证据，首尾不能占满预算", () => {
    const source = "开头背景".repeat(1100) + "目标唯一证据：审批超时应自动转交备用审批人。" + "中间补充".repeat(2200) + "结尾附录".repeat(1100);
    const found = retrieveTextContext(source, "审批超时", {maxChars:4800,maxChunks:2});
    expect(found).toContain("目标唯一证据");
    expect(found.length).toBeLessThanOrEqual(4800);
  });
  it("中文不同句式可找到相关内容", () => {
    const source = "简介\n".repeat(2000) + "超时由备用负责人接手处理异常" + "\n附录".repeat(2000);
    expect(retrieveTextContext(source, "减少等待，明确转交", {maxChars:700,maxChunks:1})).toContain("备用负责人");
  });
  it("小预算保留相关证据而非最后裁掉它", () => {
    const source = "背景".repeat(3000) + "独特关键短语ABC123" + "尾部".repeat(3000);
    expect(retrieveTextContext(source, "ABC123", {maxChars:200,maxChunks:1})).toContain("ABC123");
  });
  it("空内容、零预算、短文本安全处理", () => {
    expect(retrieveTextContext(undefined,"词")).toBe("");
    expect(retrieveTextContext("文本","词",{maxChars:0})).toBe("");
    expect(retrieveTextContext("不允许修改审批人","修改审批人")).toBe("不允许修改审批人");
  });
});
