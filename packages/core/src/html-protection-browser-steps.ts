import type { AcceptanceCriterion, EvolveProject, TestCase } from "@evolution/contracts";

function hasId(html: string, id: string) {
  return new RegExp(`\\bid\\s*=\\s*["']${id}["']`, "i").test(html);
}

function slideIds(html: string) {
  return [...html.matchAll(/<article\b[^>]*>/gi)].flatMap(([tag]) => {
    if (!/\bclass\s*=\s*["'][^"']*\bslide-card\b/i.test(tag)) return [];
    const id = tag.match(/\bid\s*=\s*["'](slide-\d+)["']/i)?.[1];
    return id ? [id] : [];
  });
}

/** Build only assertions grounded in a single complete, self-contained source HTML file. */
export function sourceGroundedHtmlProtectionSteps(project: EvolveProject, criteria: AcceptanceCriterion[], test: TestCase) {
  if (test.executionMode !== "external-runner" || ((test.browserSteps?.length ?? 0) > 0
    && !test.tags?.includes("source-grounded-html-assertions"))) return undefined;
  if (!criteria.some((criterion) => criterion.id === "PROTECT-ALL" || criterion.id === "SYS-INTEGRITY")) return undefined;
  const scopedIds = new Set(criteria.flatMap((criterion) => criterion.artifactIds));
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target" && (!scopedIds.size || scopedIds.has(artifact.id)));
  if (targets.length !== 1 || !/^(html|htm)$/i.test(targets[0]!.extension)) return undefined;
  const html = targets[0]!.textContent ?? "";
  if (!/<html\b/i.test(html) || !/<\/html\s*>/i.test(html) || !/<body\b/i.test(html) || !/<\/body\s*>/i.test(html)) return undefined;
  const slides = slideIds(html);
  // Do not turn arbitrary markup into a fake behavior check. The selectors and the
  // search-hidden transition must all exist in the original file before we emit steps.
  if (!slides.length || new Set(slides).size !== slides.length || !hasId(html, "search") || !hasId(html, "searchCount")
    || !/\.search-hidden\b/.test(html) || !/addEventListener\s*\(\s*["']input["']/.test(html)) return undefined;
  const unmatched = "__evolution_runner_no_match_9f6d2__";
  if (html.toLowerCase().includes(unmatched.toLowerCase())) return undefined;
  const first = `#${slides[0]}`;
  const last = `#${slides[slides.length - 1]}`;
  const firstTag = [...html.matchAll(/<article\b[^>]*>/gi)].find(([tag]) => hasId(tag, slides[0]!))?.[0];
  const searchText = firstTag?.match(/\bdata-search\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
  // A positive indexed word prevents an implementation that hides every result from passing.
  const query = searchText?.replace(/&[^;\s]+;/g, " ").match(/[\p{L}]{2,32}/u)?.[0]?.toLowerCase();
  if (!query || !/\.dataset\.search\.includes\s*\(/.test(html)) return undefined;
  const initial = [
    { action: "visible" as const, selector: first },
    { action: "visible" as const, selector: last },
    { action: "visible" as const, selector: "#search" },
  ];
  const negative = [
    { action: "fill" as const, selector: "#search", value: unmatched },
    { action: "count" as const, selector: ".slide-card:not(.search-hidden)", count: 0 },
    { action: "text" as const, selector: "#searchCount", value: "0 页命中" },
  ];
  const positive = [
    { action: "fill" as const, selector: "#search", value: query },
    { action: "visible" as const, selector: first },
  ];
  const clear = [
    { action: "fill" as const, selector: "#search", value: "" },
    { action: "count" as const, selector: ".slide-card.search-hidden", count: 0 },
    { action: "visible" as const, selector: first },
    { action: "visible" as const, selector: last },
  ];
  // First establish an empty result. The positive check must observe a transition
  // out of that state, rather than accept pre-input visibility before a debounce.
  const steps = [...initial, ...negative, ...positive, ...negative, ...clear];
  if ((test.browserSteps?.length ?? 0) > 0) {
    const legacy = [...initial, ...positive, ...negative, ...clear];
    const canonical = (value: unknown[]) => JSON.stringify(value.map((step) =>
      Object.fromEntries(Object.entries(step as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)))));
    // Refresh only our tagged exact prior recipe against this same Source.
    // Edited/user-authored contracts stay intact; new steps change paper identity.
    if (canonical(test.browserSteps!) !== canonical(legacy)) return undefined;
  }
  return steps;
}

/** Persisted generated papers must be confirmed before a frozen server comparison. */
export function htmlProtectionContractBlocker(project: EvolveProject): string | undefined {
  const criteriaById = new Map((project.acceptanceRubric ?? []).map((criterion) => [criterion.id, criterion]));
  const outdated = [...(project.evalSuite ?? []), ...(project.hiddenEvalSuite ?? [])].filter((test) =>
    (test.browserSteps?.length ?? 0) > 0 && sourceGroundedHtmlProtectionSteps(project,
      test.criterionIds.flatMap((id) => { const criterion = criteriaById.get(id); return criterion ? [criterion] : []; }), test));
  if (!outdated.length) return undefined;
  return "[html-protection-contract-pending] 自动生成的搜索验收步骤需更新并重新确认考卷：" + outdated.map((test) => test.id).join("、")
    + "。旧执行记录不能证明新断言；服务端不会在冻结比较中改写 Hidden 考卷。";
}
