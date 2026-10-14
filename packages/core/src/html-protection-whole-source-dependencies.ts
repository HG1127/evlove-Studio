import { parse } from "@babel/parser";
import type { HtmlProtectionWholeRuntimeSourcePlan } from "@evolution/contracts";
import { htmlProtectionScriptEffectProfile } from "./html-protection-script-effect-profile";

const textReads = new Set(["textContent", "innerText", "outerText", "nodeValue", "data"]);
const markupReads = new Set(["innerHTML", "outerHTML"]);
const geometryReads = new Set(["scrollHeight", "scrollWidth", "scrollTop", "scrollLeft", "scrollY", "scrollX", "offsetHeight", "offsetWidth", "clientHeight", "clientWidth", "innerWidth", "innerHeight", "isIntersecting"]);
const inputReads = new Set(["value", "checked", "selectedIndex", "selectionStart", "selectionEnd"]);
const structureReads = new Set(["children", "childNodes", "firstChild", "lastChild", "parentElement", "parentNode", "nextSibling", "previousSibling", "target", "currentTarget", "documentElement", "head", "body", "length", "classList", "style", "dataset", "tagName", "nodeName", "attributes"]);
/** Entire Original source dependency graph. A classified dependency is not proof that a text change leaves its runtime value/effects unchanged. */
export function htmlProtectionWholeSourceDependencyProfile(plan: HtmlProtectionWholeRuntimeSourcePlan) {
  return plan.scriptShape.map(source => {
    const effect = htmlProtectionScriptEffectProfile({ parentId: source.id, literal: source.literal });
    const reads: Array<{ sourceRange: { start: number; end: number }; property: string; kind: "text" | "markup" | "geometry" | "input" | "structure" | "attribute-or-local" | "ambient" | "unknown"; expression: unknown }> = [];
    const gaps = new Set(effect.gaps); let dynamicReads = 0;
    if (source.literal === null) return { parentId: source.id, reads, gaps: ["complete-source-dependencies-unavailable"], bootOnly: false, textMutationCanAffectDependencies: true };
    try {
      const ast = parse(source.literal, { sourceType: "unambiguous" });
      function clean(value: unknown): unknown { if (Array.isArray(value)) return value.map(clean); if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => !["loc", "comments", "extra", "start", "end"].includes(key)).map(([key, value]) => [key, clean(value)])); }
      function walk(value: unknown, parent?: Record<string, unknown>, childKey?: string) {
        if (!value || typeof value !== "object") return;
        const node = value as Record<string, unknown>;
        if (["MemberExpression", "OptionalMemberExpression"].includes(String(node.type))) {
          const isWrite = parent && ((parent.type === "AssignmentExpression" && childKey === "left") || (parent.type === "UpdateExpression" && childKey === "argument"));
          const isCall = parent && ["CallExpression", "OptionalCallExpression", "NewExpression"].includes(String(parent.type)) && childKey === "callee";
          if (!isWrite && !isCall) {
            const field = node.property as Record<string, unknown>, name = !node.computed && field?.type === "Identifier" ? String(field.name) : node.computed && field?.type === "StringLiteral" ? String(field.value) : null;
            let kind: typeof reads[number]["kind"] = "attribute-or-local";
            if (name === null) { kind = "unknown"; dynamicReads++; }
            else if (textReads.has(name)) kind = "text"; else if (markupReads.has(name)) kind = "markup"; else if (geometryReads.has(name)) kind = "geometry";
            else if (inputReads.has(name)) kind = "input"; else if (structureReads.has(name)) kind = "structure";
            else if (["cookie", "location", "localStorage", "sessionStorage", "performance", "now", "random", "prototype", "__proto__"].includes(name)) kind = "ambient";
            reads.push({ sourceRange: { start: Number(node.start), end: Number(node.end) }, property: name ?? "computed", kind, expression: clean(node) });
          }
        }
        for (const [key, child] of Object.entries(node)) if (!["loc", "comments", "extra"].includes(key)) { if (Array.isArray(child)) child.forEach(value => walk(value, node, key)); else if (child && typeof child === "object") walk(child, node, key); }
      }
      walk(ast);
    } catch { gaps.add("complete-source-dependencies-unavailable"); }
    if (dynamicReads) gaps.add("dynamic-dependency-receiver-unresolved");
    const bootOnly = effect.completeSourceGraph && !effect.effects.some(item => ["event", "timer", "intersection", "clipboard", "scroll", "unknown"].includes(item.kind))
      && !Object.keys(source.operationCensus).some(name => ["then", "Promise", "requestAnimationFrame", "setTimeout", "setInterval"].includes(name));
    return { parentId: source.id, reads, bootOnly, completeSourceGraph: effect.completeSourceGraph, completeEffectClassification: effect.completeEffectClassification,
      literalSelectors: effect.effects.filter(item => item.kind === "selector" && item.literalSelector !== undefined).map(item => item.literalSelector!),
      textMutationCanAffectDependencies: reads.some(read => ["text", "markup", "geometry", "unknown", "ambient"].includes(read.kind)),
      requiredNativeDependencyKinds: [...new Set(reads.map(read => read.kind))], gaps: [...gaps].sort(),
      limitations: ["DOM attributes/structure read after an earlier script require native producer observations at that causal boundary, not just equality in the physical HTML.",
        "Text/markup and intrinsic geometry depend on actual allowed refinements; complete code equality is not a complete effect/value proof."] };
  });
}
