import { parse } from "@babel/parser";
import type { HtmlProtectionWholeRuntimeSourcePlan, HtmlProtectionWholeRuntimeRegistration, HtmlProtectionWholeRuntimeAction } from "@evolution/contracts";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionScriptEffectProfile } from "./html-protection-script-effect-profile";

const version = "original-owned-whole-runtime-v1" as const;
const attr = (element: ReturnType<typeof htmlProtectionInventory>["documentElements"][number], name: string) => element.attributes.find(item => item.name === name)?.value;
const knownCalls = new Set(["querySelector", "querySelectorAll", "getElementById", "qs", "qsa", "$", "$$", "addEventListener", "createElement",
  "appendChild", "prepend", "after", "before", "replaceWith", "remove", "cloneNode", "closest", "getAttribute", "setAttribute", "add", "toggle", "contains",
  "forEach", "map", "flatMap", "filter", "find", "some", "every", "sort", "slice", "split", "join", "push", "shift", "trim", "toLowerCase", "replace", "normalize", "includes",
  "test", "padStart", "String", "setTimeout", "IntersectionObserver", "observe", "unobserve", "scrollTo", "writeText", "then", "showToast", "txt", "updateProgress"]);
function scriptProfile(literal: string | null) {
  const operationCensus: Record<string, number> = {}, unsupported = new Set<string>();
  if (literal === null) return { operationCensus, unsupportedOperations: ["missing-complete-script-source"], parseComplete: false };
  try {
    const ast = parse(literal, { sourceType: "unambiguous" });
    let nodes = 0;
    function walk(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (++nodes > 100_000) throw Error("script-node-budget");
      const node = value as Record<string, unknown>;
      if (["ImportDeclaration", "ImportExpression", "WithStatement", "TaggedTemplateExpression"].includes(String(node.type))) unsupported.add(String(node.type));
      if (["CallExpression", "NewExpression", "OptionalCallExpression"].includes(String(node.type))) {
        const callee = node.callee as Record<string, unknown>;
        const property = callee?.property as Record<string, unknown> | undefined;
        const name = callee?.type === "Identifier" ? String(callee.name) : ["MemberExpression", "OptionalMemberExpression"].includes(String(callee?.type)) && !callee.computed ? String(property?.name) : "dynamic-call";
        operationCensus[name] = (operationCensus[name] ?? 0) + 1;
        // An IIFE has an explicit complete body, unlike an unknown dynamically selected call.
        if (!knownCalls.has(name) && !(name === "dynamic-call" && ["FunctionExpression", "ArrowFunctionExpression"].includes(String(callee?.type)))) unsupported.add(name);
      }
      for (const [key, child] of Object.entries(node)) if (!["loc", "comments", "tokens", "extra"].includes(key)) {
        if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === "object") walk(child);
      }
    }
    walk(ast);
    return { operationCensus, unsupportedOperations: [...unsupported].sort(), parseComplete: true };
  } catch { return { operationCensus, unsupportedOperations: ["incomplete-script-analysis"], parseComplete: false }; }
}
/** Every source parent survives; enumerated native coverage never implies arbitrary JS or continuous-layout completeness. */
export function htmlProtectionWholeRuntimeSourcePlan(args: { original: HtmlProtectionWholeRuntimeSourcePlan["original"]; html: string }): HtmlProtectionWholeRuntimeSourcePlan {
  const inventory = htmlProtectionInventory({ sourceArtifactId: args.original.sourceArtifactId, html: args.html });
  const gaps = new Set<string>();
  if (inventory.parseErrorCount) gaps.add("original-parse-uncertainty");
  if (inventory.duplicateIds.length) gaps.add("duplicate-original-identity");
  if (inventory.handlers.length) gaps.add("inline-handler-profile-unresolved");
  if (inventory.references.some(reference => reference.value && !reference.value.startsWith("#"))) gaps.add("external-or-unsupported-resource-reference");
  const breakpoints = new Set<number>();
  for (const style of inventory.styles) {
    if (!style.hasClosingTag || style.bodyLiteral === null) gaps.add("incomplete-original-style");
    const text = style.bodyLiteral ?? "";
    const media = [...text.matchAll(/@media\s*([^{}]+)\{/gi)].map(match => match[1]!);
    for (const expression of media) {
      const matches = [...expression.matchAll(/(?:min|max)-width\s*:\s*(\d+)px/gi)];
      if (!matches.length || expression.replace(/\(\s*(?:min|max)-width\s*:\s*\d+px\s*\)/gi, "").replace(/\b(?:and|or|only|screen|all)\b|[,\s]/gi, "").length) gaps.add("responsive-query-unresolved");
      for (const match of matches) { const width = Number(match[1]); if (width >= 240 && width <= 2560) breakpoints.add(width); else gaps.add("responsive-width-outside-bounded-domain"); }
    }
    if (/\burl\s*\(/i.test(text)) gaps.add("css-resource-resolution-unavailable");
    if (/@(?:container|supports|import|keyframes|font-face)\b/i.test(text)) gaps.add("additional-css-runtime-domain");
  }
  const widths = new Set([240, 390, 1280, 2560]);
  for (const breakpoint of breakpoints) for (const delta of [-1, 0, 1]) if (breakpoint + delta >= 240 && breakpoint + delta <= 2560) widths.add(breakpoint + delta);
  if (widths.size > 40) gaps.add("responsive-plan-capacity-unavailable");
  const cards = inventory.documentElements.filter(element => (attr(element, "class") ?? "").split(/\s+/).includes("slide-card"));
  const queryPositive = cards.map(card => attr(card, "data-search")?.match(/[\p{L}\p{N}]{2,32}/u)?.[0]).find(Boolean) ?? null;
  if (!queryPositive) gaps.add("source-query-positive-unavailable");
  let queryNegative = "__evolution_whole_runtime_no_match_0__";
  for (let index = 0; args.html.toLowerCase().includes(queryNegative) && index < 128; index++) queryNegative = "__evolution_whole_runtime_no_match_" + (index + 1) + "__";
  if (args.html.toLowerCase().includes(queryNegative)) gaps.add("source-query-negative-unavailable");
  const scriptShape = inventory.scripts.filter(script => script.potentialExecutable || script.runtimeConfiguration || script.activationUnresolved).map(script => ({
    id: "runtime-script:" + script.index, sourcePath: script.path, kind: script.kind, literal: script.bodyLiteral, ...scriptProfile(script.bodyLiteral),
    effectProfile: htmlProtectionScriptEffectProfile({ parentId: "runtime-script:" + script.index, literal: script.bodyLiteral }),
  }));
  // Operation recognition is planning evidence, never a semantic or residual proof.
  if (scriptShape.length) gaps.add("arbitrary-script-causality-not-proved");
  if (scriptShape.some(script => !script.parseComplete || script.unsupportedOperations.length || !script.effectProfile.completeEffectClassification || script.effectProfile.gaps.length)) gaps.add("script-profile-unresolved");
  if (inventory.scripts.some(script => script.src || script.kind !== "classic" || script.inertContext)) gaps.add("script-activation-or-dependency-unavailable");
  return { schemaVersion: version, original: { ...args.original }, sourceCensus: { elements: inventory.documentElements.length,
    cards: inventory.cards.length, scripts: inventory.scripts.length, styles: inventory.styles.length,
    controls: inventory.runtimeObligations.filter(item => item.id.startsWith("runtime-control:")).length },
    originalElementPaths: inventory.documentElements.map(element => element.path), runtimeParentIds: inventory.runtimeObligations.map(item => item.id),
    scriptShape, viewports: widths.size <= 40 ? [...widths].sort((a, b) => a - b).map(width => ({ width, height: 900 })) : [{ width: 1280, height: 900 }],
    queryPositive, queryNegative, gaps: [...gaps].sort() };
}
/** Derive every actual action from trusted Original boot controls; not Candidate census or external commands. */
export function htmlProtectionWholeRuntimeActions(plan: HtmlProtectionWholeRuntimeSourcePlan, registration: HtmlProtectionWholeRuntimeRegistration): HtmlProtectionWholeRuntimeAction[] {
  if (registration.original.sourceArtifactId !== plan.original.sourceArtifactId || registration.original.sha256 !== plan.original.sha256
    || registration.original.byteLength !== plan.original.byteLength) throw Error("Foreign Original runtime registration");
  const result: HtmlProtectionWholeRuntimeAction[] = [];
  const add = (target: { targetId: string; selector: string }, operation: HtmlProtectionWholeRuntimeAction["operation"], intent: HtmlProtectionWholeRuntimeAction["intent"], value?: string) => {
    result.push({ stateId: "owned-state:" + result.length, targetId: target.targetId, selector: target.selector, operation, intent, ...(value === undefined ? {} : { value }) });
  };
  add({ targetId: "document", selector: "html" }, "boot", "boot");
  for (const viewport of plan.viewports) result.push({ stateId: "owned-state:" + result.length, targetId: "document", selector: "html", operation: "viewport", intent: "responsive", viewport });
  for (const control of registration.controls) {
    if (control.kind === "menu") result.push({ stateId: "owned-state:" + result.length, targetId: "document", selector: "html", operation: "viewport", intent: "responsive", viewport: { width: 390, height: 900 } });
    if (control.kind === "search") {
      if (plan.queryPositive !== null) add(control, "fill", "query-positive", plan.queryPositive);
      add(control, "fill", "query-negative", plan.queryNegative); add(control, "fill", "clear", "");
    } else if (control.kind === "copy") add(control, "copy", "copy");
    else if (control.kind === "menu") { add(control, "click", "menu-open"); add(control, "click", "menu-close"); }
    else if (control.kind === "check") { /* Run the complete cumulative checked domain below. */ }
    else if (control.kind === "details") { add(control, "click", "details-open"); add(control, "click", "details-close"); }
    else if (control.kind === "anchor") add(control, "click", "navigate", control.href ?? undefined);
    else if (control.kind === "top") add(control, "click", "top");
    add(control, "hover", "hover-enter"); add(control, "hover", "hover-leave");
    if (control.kind === "menu") result.push({ stateId: "owned-state:" + result.length, targetId: "document", selector: "html", operation: "viewport", intent: "responsive", viewport: { width: 1280, height: 900 } });
  }
  for (const control of registration.controls.filter(item => item.kind === "check")) add(control, "click", "check-on");
  for (const control of registration.controls.filter(item => item.kind === "check")) add(control, "click", "check-off");
  for (const target of registration.revealTargets) add(target, "scroll", "reveal");
  return result;
}
/** Coverage map only. Unresolved source parents survive native sampling and cannot be upgraded here. */
export function assessHtmlProtectionWholeRuntimeSourceCoverage(plan: HtmlProtectionWholeRuntimeSourcePlan, actual: {
  registration: HtmlProtectionWholeRuntimeRegistration; actions: readonly { action: HtmlProtectionWholeRuntimeAction; status: string; dispatched: number; settled: boolean }[];
}) {
  const expected = htmlProtectionWholeRuntimeActions(plan, actual.registration);
  const complete = expected.length === actual.actions.length && expected.every((action, index) => JSON.stringify(action) === JSON.stringify(actual.actions[index]?.action)
    && actual.actions[index]?.status === "observed" && actual.actions[index]?.settled
    && actual.actions[index]?.dispatched === (action.operation === "boot" ? 0 : 1));
  return { completeNativeSequence: complete, sourcePlanGaps: [...plan.gaps],
    unresolvedRuntimeParentIds: [...plan.runtimeParentIds], supportedRuntimeParentIds: [] as string[],
    gaps: [...(complete ? [] : ["complete-native-sequence-missing"]), ...actual.registration.gaps,
      ...(plan.runtimeParentIds.length ? ["source-parent-residual-closure-unproved"] : [])] };
}
