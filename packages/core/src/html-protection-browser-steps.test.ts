import { describe, expect, it } from "vitest";
import type { EvolveProject, TestCase } from "@evolution/contracts";
import { sourceGroundedHtmlProtectionSteps } from "./html-protection-browser-steps";
import { normalizeEvalSuiteForProject } from "./eval-suite-normalization";

const html = `<html><head><style>.search-hidden{display:none}</style></head><body>
  <input id="search"><span id="searchCount"></span>
  <article class="slide-card" id="slide-2" data-search="intro">Intro</article>
  <article class="slide-card" id="slide-3" data-search="end">End</article>
  <script>const search=document.querySelector('#search');search.addEventListener('input',()=>{
    document.querySelectorAll('.slide-card').forEach(card=>card.classList.toggle('search-hidden',!card.dataset.search.includes(search.value)));
    document.querySelector('#searchCount').textContent='0 页命中';
  });</script></body></html>`;
const criterion = { id: "PROTECT-ALL", title: "保护交互", requirement: "原有搜索交互可用", validationMethod: "semantic-judge", protectedConstraint: true, artifactIds: ["html"] } as EvolveProject["acceptanceRubric"][number];
const testCase = { id: "protect", title: "保护交互", input: "检查搜索", expected: ["搜索可用"], tags: [], hidden: true, criterionIds: [criterion.id], executionMode: "external-runner", evidenceScope: "product-behavior" } as TestCase;
const project = { sourceArtifacts: [{ id: "html", name: "guide.html", role: "target", extension: "html", textContent: html }], acceptanceRubric: [criterion] } as EvolveProject;

describe("source-grounded HTML protection steps", () => {
  it("adds a real fill-and-assert interaction to an empty Runner contract", () => {
    const steps = sourceGroundedHtmlProtectionSteps(project, [criterion], testCase)!;
    expect(steps).toContainEqual({ action: "visible", selector: "#slide-2" });
    expect(steps).toContainEqual({ action: "visible", selector: "#slide-3" });
    expect(steps).toContainEqual({ action: "count", selector: ".slide-card:not(.search-hidden)", count: 0 });
    expect(steps.some((step) => step.action === "fill")).toBe(true);
    expect(steps).toContainEqual({ action: "fill", selector: "#search", value: "intro" });
    expect(steps).toHaveLength(12);
    const normalized = normalizeEvalSuiteForProject({ ...project, hiddenEvalSuite: [testCase] }, [], [testCase]).hiddenCases[0]!;
    expect(normalized.executionMode).toBe("external-runner");
    expect(normalized.browserSteps).toEqual(steps);
    expect(normalized.tags).toContain("source-grounded-html-assertions");
  });

  it("does not invent behavior for unrelated markup or overwrite explicit steps", () => {
    expect(sourceGroundedHtmlProtectionSteps(project, [criterion], { ...testCase, browserSteps: [{ action: "visible", selector: "#custom" }] })).toBeUndefined();
    const noSearch = { ...project, sourceArtifacts: [{ ...project.sourceArtifacts[0]!, textContent: "<html><body><article class='slide-card' id='slide-2'>Only content</article></body></html>" }] };
    expect(sourceGroundedHtmlProtectionSteps(noSearch, [criterion], testCase)).toBeUndefined();
  });
});
