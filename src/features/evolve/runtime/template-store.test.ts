import { beforeEach, describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { deleteTemplate, duplicateTemplate, getTemplate, listTemplates, recordTemplateUse, saveTemplate, templateFromProject } from "./template-store";

beforeEach(() => {
  window.localStorage.clear();
});

describe("模板中心存储与联动", () => {
  it("默认提供内置模板且标记为内置", () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(8);
    expect(templates.every((template) => template.builtIn)).toBe(true);
  });

  it("自定义模板可增改删，且排在内置模板之前", () => {
    const seed = listTemplates()[0]!;
    const custom = { ...seed, id: "tpl-mine", name: "客诉回复模板", builtIn: false, useCount: 0, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
    saveTemplate(custom);
    expect(listTemplates()[0]!.id).toBe("tpl-mine");
    saveTemplate({ ...custom, name: "客诉回复模板 V2" });
    expect(getTemplate("tpl-mine")!.name).toBe("客诉回复模板 V2");
    expect(listTemplates().filter((template) => template.id === "tpl-mine").length).toBe(1);
    deleteTemplate("tpl-mine");
    expect(getTemplate("tpl-mine")).toBeUndefined();
    // 删除自定义模板不得影响内置模板
    expect(listTemplates().length).toBeGreaterThanOrEqual(8);
  });

  it("使用统计回写并持久化，内置模板可复制为自定义", () => {
    const builtIn = listTemplates()[0]!;
    recordTemplateUse(builtIn.id);
    recordTemplateUse(builtIn.id);
    expect(getTemplate(builtIn.id)!.useCount).toBe(2);
    expect(getTemplate(builtIn.id)!.lastUsedAt).toBeTruthy();
    const copy = duplicateTemplate(builtIn.id);
    expect(copy?.builtIn).toBe(false);
    expect(copy?.useCount).toBe(0);
    expect(getTemplate(copy!.id)).toBeDefined();
  });

  it("项目可沉淀为模板，复用目标、部门与指标", () => {
    const project = {
      ...demoProject,
      id: "p1",
      goal: "让周报的每个结论都有证据",
      metrics: [{ key: "m1", label: "证据", value: 0, unit: "%", target: 90, direction: "higher" as const, description: "" }],
    };
    const template = templateFromProject(project);
    expect(template.goal).toBe(project.goal);
    expect(template.department).toBe(project.department);
    expect(template.metrics).toEqual(["证据"]);
    saveTemplate(template);
    expect(getTemplate(template.id)?.builtIn).toBe(false);
  });
});
