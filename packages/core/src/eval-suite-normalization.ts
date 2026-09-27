import type { AcceptanceCriterion, EvolveProject, TestCase } from "@evolution/contracts";
import { criterionCanUseLocalSnapshotEvidence } from "./criterion-evidence";
export { criterionCanUseLocalSnapshotEvidence } from "./criterion-evidence";

const INTERNAL_PATTERN = /(src\/|docs\/|\.tsx?\b|\.jsx?\b|\.test\.|\.spec\.|typeid\b|semantic-evolution|workflow-engine|artifact-compatibility|tailwind|css\s*token|theme\s*token|index\.css|schema\.ts|local-store|validation-report|vitest|playwright|babel|parser\/builder|undefined\s*断点)/i;
const VISUAL_PATTERN = /(ui\/?ux|界面|视觉|审美|布局|交互习惯|可读性|导航|响应式|样式)/i;
const RUNTIME_PATTERN = /(运行|端到端|e2e|点击|交互|上传|拖拽|导入|输入兼容|兼容性|接入|切换|保存|创建项目|用户操作|流程闭环|实际执行)/i;

function methodMode(method: AcceptanceCriterion["validationMethod"]): TestCase["executionMode"] {
  switch (method) {
    case "static-structure": return "static-evidence";
    case "format-roundtrip": return "roundtrip";
    case "cross-artifact": return "static-evidence";
    case "visual-review": return "visual-review";
    case "executable-test": return "external-runner";
    case "manual-review": return "manual";
    case "user-scenario": return "artifact-runtime";
    case "semantic-judge":
    default: return "artifact-runtime";
  }
}

function scopeFor(method: AcceptanceCriterion["validationMethod"]): TestCase["evidenceScope"] {
  if (method === "format-roundtrip") return "format";
  if (method === "cross-artifact") return "cross-artifact";
  if (method === "static-structure" || method === "executable-test") return "implementation";
  return "product-behavior";
}

function isCodebaseProject(project: EvolveProject) {
  return project.sourceArtifacts.some((artifact) => artifact.role === "target" && artifact.artifactKind === "codebase")
    || project.objectType === "codebase"
    || project.semanticEvolution?.semanticObject.typeId === "software-system";
}

function executionForProject(project: EvolveProject, criteria: AcceptanceCriterion[], test: TestCase) {
  const methods = criteria.map((item) => item.validationMethod);
  if (methods.includes("executable-test")) return { executionMode: "external-runner" as const, evidenceScope: "implementation" as const };
  if (methods.includes("visual-review")) return { executionMode: "visual-review" as const, evidenceScope: "product-behavior" as const };
  if (methods.includes("format-roundtrip")) return { executionMode: "roundtrip" as const, evidenceScope: "format" as const };
  if (methods.includes("cross-artifact")) return { executionMode: "static-evidence" as const, evidenceScope: "cross-artifact" as const };
  if (methods.includes("static-structure")) return { executionMode: "static-evidence" as const, evidenceScope: "implementation" as const };
  if (methods.includes("manual-review")) return { executionMode: "manual" as const, evidenceScope: "product-behavior" as const };
  if (methods.length > 0 && methods.every((method) => method === "semantic-judge")) return { executionMode: "artifact-runtime" as const, evidenceScope: "product-behavior" as const };

  // Evidence requirements belong to the acceptance contract, not to the currently
  // selected adapter. Connecting a Runner must not silently turn a real runtime
  // scenario back into an AI-simulated artifact-runtime check.
  if (isCodebaseProject(project)) {
    const combined = `${test.title} ${test.input} ${test.expected.join(" ")} ${criteria.map((item)=>`${item.title} ${item.requirement}`).join(" ")}`;
    if (VISUAL_PATTERN.test(combined)) return { executionMode: "visual-review" as const, evidenceScope: "product-behavior" as const };
    if (RUNTIME_PATTERN.test(combined)) return { executionMode: "external-runner" as const, evidenceScope: "product-behavior" as const };
    // Codebase product goals that do not require runtime interaction can at least collect static implementation evidence.
    return { executionMode: "static-evidence" as const, evidenceScope: "implementation" as const };
  }

  const method = methods[0] ?? "semantic-judge";
  return { executionMode: methodMode(method), evidenceScope: scopeFor(method) };
}

function cleanImplementationSentences(value: string) {
  const segments = value.split(/(?<=[。；;\n])/).map((item) => item.trim()).filter(Boolean);
  const clean = segments.filter((item) => !INTERNAL_PATTERN.test(item));
  return clean.join(" ").trim();
}

function sanitizeImplementationCoupling(project: EvolveProject, test: TestCase, mapped: AcceptanceCriterion[]) {
  const command = project.evolutionCommand ?? "";
  const combined = `${test.input}\n${test.expected.join("\n")}`;
  if (!INTERNAL_PATTERN.test(combined) || INTERNAL_PATTERN.test(command)) return test;
  const expected = [...new Set(mapped.flatMap((criterion) => criterion.evidenceExpected.length ? criterion.evidenceExpected : [criterion.requirement]))].slice(0, 8);
  const cleanedInput = cleanImplementationSentences(test.input);
  const requirements = mapped.map((criterion) => criterion.requirement).join("；");
  return {
    ...test,
    input: cleanedInput || `从最终用户/业务使用视角验证这个场景。验收重点：${requirements}`,
    expected: expected.length ? expected : [requirements || "从用户结果判断是否满足本项目进化目标"],
    tags: [...new Set([...test.tags, "user-visible", "de-implementation-coupled"])],
  };
}

function namedConcepts(value: string) {
  return new Set((value.match(/[A-Za-z][A-Za-z0-9._/-]{2,}/g) ?? []).map((item) => item.toLowerCase()));
}

/**
 * A model occasionally binds one criterion id but copies expectations from neighbouring criteria.
 * That makes a "Git" case silently grade Supabase/Vercel too and double-count the same gap. When a
 * single-criterion case mentions a distinctive named concept owned only by another criterion, reset
 * its contract to the mapped criterion. Multi-criterion integration cases keep their combined scope.
 */
function constrainSingleCriterionCase(project: EvolveProject, test: TestCase, mapped: AcceptanceCriterion[]) {
  if (mapped.length !== 1) return test;
  const criterion = mapped[0]!;
  // Only inspect the expected result for concepts named by criterion titles. Scenario text may
  // legitimately mention neighbouring systems as context; only the grading contract must stay scoped.
  const ownConcepts = namedConcepts(criterion.title);
  const combined = test.expected.join(" ").toLowerCase();
  const leaks = project.acceptanceRubric.some((other) => other.id !== criterion.id
    && [...namedConcepts(other.title)].some((concept) => !ownConcepts.has(concept) && combined.includes(concept)));
  if (!leaks) return test;
  return {
    ...test,
    input: `从最终用户/业务视角，只验证「${criterion.title}」：${criterion.requirement}。不得用其他验收标准的缺口重复扣分。`,
    expected: criterion.evidenceExpected.length ? criterion.evidenceExpected : [criterion.requirement],
    tags: [...new Set([...test.tags, "criterion-scope-repaired"])],
  };
}

/**
 * Normalize AI-generated test cases into an evidence-aware suite.
 * Parser/runtime capability limitations are represented as verification mode, not as fake product failures.
 */
export function normalizeEvalSuiteForProject(project: EvolveProject, validationCases: TestCase[], hiddenCases: TestCase[]) {
  const rubric = new Map(project.acceptanceRubric.map((criterion) => [criterion.id, criterion]));
  const normalize = (test: TestCase, hidden: boolean): TestCase[] => {
    const mapped = test.criterionIds.flatMap((id) => { const criterion = rubric.get(id); return criterion ? [criterion] : []; });
    const sanitized = sanitizeImplementationCoupling(project, { ...test, hidden }, mapped);
    const scoped = constrainSingleCriterionCase(project, sanitized, mapped);
    if (mapped.length <= 1) {
      const mode = executionForProject(project, mapped, scoped);
      return [{ ...scoped, ...mode, hidden }];
    }

    // One generated test can accidentally bind semantic/format/visual/E2E criteria together. If the
    // whole case is routed to the strictest mode (for example visual-review), unrelated criteria are
    // incorrectly blocked by missing screenshots. Split by actual evidence route instead: each
    // criterion is judged only by the evidence type declared in its own acceptance contract.
    const groups = new Map<string, { criteria: AcceptanceCriterion[]; mode: ReturnType<typeof executionForProject> }>();
    for (const criterion of mapped) {
      const mode = executionForProject(project, [criterion], scoped);
      const key = `${mode.executionMode}:${mode.evidenceScope}`;
      const group = groups.get(key) ?? { criteria: [], mode };
      group.criteria.push(criterion);
      groups.set(key, group);
    }
    if (groups.size === 1) {
      const mode = [...groups.values()][0]!.mode;
      return [{ ...scoped, ...mode, hidden }];
    }
    return [...groups.values()].map((group, index) => {
      const criterionIds = group.criteria.map((criterion) => criterion.id);
      const expected = [...new Set(group.criteria.flatMap((criterion) => criterion.evidenceExpected.length ? criterion.evidenceExpected : [criterion.requirement]))].slice(0, 8);
      const separated = constrainSingleCriterionCase(project, {
        ...scoped,
        id: `${scoped.id}-evidence-${index + 1}`,
        criterionIds,
        expected,
        tags: [...new Set([...scoped.tags, "evidence-route-split"])],
      }, group.criteria);
      return { ...separated, ...group.mode, hidden };
    });
  };
  return {
    validationCases: validationCases.flatMap((test) => normalize(test, false)),
    hiddenCases: hiddenCases.flatMap((test) => normalize(test, true)),
  };
}

export type CriterionEvidenceRoute = "visual" | "manual" | "runner" | "local" | "capability";

/**
 * Resolve the user-facing evidence action from the same normalized Hidden Test
 * contract that validation executes. This prevents the UI from asking for a
 * Runner while the runtime is actually using static/artifact evidence (or the
 * reverse) after a connection change.
 */
export function evidenceRouteForCriterion(project: EvolveProject, criterion: AcceptanceCriterion): CriterionEvidenceRoute {
  const modes = normalizeEvalSuiteForProject(project, [], project.hiddenEvalSuite).hiddenCases
    .filter((test) => test.criterionIds.includes(criterion.id))
    .map((test) => test.executionMode);

  if (modes.includes("visual-review")) return "visual";
  if (modes.includes("manual")) return "manual";
  if (modes.includes("external-runner")) return "runner";
  if (criterionCanUseLocalSnapshotEvidence(project, criterion)) return "local";
  // A document scenario with no reviewable source structure cannot be fixed by
  // clicking the local recheck button; surface the missing capability instead.
  if (criterion.validationMethod === "user-scenario" && !isCodebaseProject(project)) return "capability";
  if (modes.length > 0) return "local";

  // Imported/legacy projects may temporarily have no mapped Hidden Test. Keep a
  // truthful fallback until suite repair creates the authoritative test case.
  if (criterion.validationMethod === "visual-review") return "visual";
  if (criterion.validationMethod === "manual-review") return "manual";
  if (criterion.validationMethod === "executable-test" || criterion.validationMethod === "user-scenario") return "runner";
  return "local";
}
