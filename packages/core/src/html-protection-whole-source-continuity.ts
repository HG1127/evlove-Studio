import { parse, type DefaultTreeAdapterTypes } from "parse5";
import type { HtmlProtectionWholeRuntimeSourcePlan } from "@evolution/contracts";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionContentScope, type HtmlProtectionFrozenContentContract } from "./html-protection-content-scope";
import { htmlProtectionWholeSourceDependencyProfile } from "./html-protection-whole-source-dependencies";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Full physical source continuity facts only. A frozen semantic-refinement requirement still needs independent meaning/visual evidence. */
export function assessHtmlProtectionWholeSourceContinuity(args: { sourcePlan: HtmlProtectionWholeRuntimeSourcePlan; originalHtml: string; executedHtml: string; frozenContentContract: HtmlProtectionFrozenContentContract }) {
  const original = htmlProtectionInventory({ sourceArtifactId: args.sourcePlan.original.sourceArtifactId, html: args.originalHtml }), executed = htmlProtectionInventory({ sourceArtifactId: args.sourcePlan.original.sourceArtifactId, html: args.executedHtml });
  const contentScope = htmlProtectionContentScope({ sourceArtifactId: args.sourcePlan.original.sourceArtifactId, frozenContract: args.frozenContentContract }), gaps = new Set<string>();
  const structuresRetained = equal(original.documentElements, executed.documentElements);
  const scriptsRetained = equal(original.scripts.map(item => ({ literal: item.literal, kind: item.kind, src: item.src, inertContext: item.inertContext })), executed.scripts.map(item => ({ literal: item.literal, kind: item.kind, src: item.src, inertContext: item.inertContext })));
  const stylesRetained = equal(original.styles.map(item => ({ literal: item.literal, inertContext: item.inertContext })), executed.styles.map(item => ({ literal: item.literal, inertContext: item.inertContext })));
  if (!structuresRetained) gaps.add("physical-source-structure-attributes-or-identity-drift"); if (!scriptsRetained) gaps.add("physical-source-script-drift"); if (!stylesRetained) gaps.add("physical-source-style-drift");
  if (original.parseErrorCount || executed.parseErrorCount || original.duplicateIds.length || executed.duplicateIds.length) gaps.add("ambiguous-physical-source-domain");
  const before = textNodes(args.originalHtml), after = textNodes(args.executedHtml), changedTextNodes = before.filter((node, index) => !equal(node, after[index]));
  if (before.length !== after.length) gaps.add("physical-source-text-node-domain-drift");
  if (changedTextNodes.some(node => !node.refinableBody) || (contentScope.mode !== "semantic-refinement" && changedTextNodes.length)) gaps.add("protected-or-unlicensed-source-text-drift");
  for (const gap of contentScope.gaps) gaps.add(gap);
  const retained = gaps.size === 0;
  return { policyVersion: "whole-physical-source-text-dependency-v1", structuresRetained, scriptsRetained, stylesRetained, sourceSignatureRetained: retained,
    changedTextNodePaths: changedTextNodes.map(node => node.path), contentScope,
    parentDependencies: htmlProtectionWholeSourceDependencyProfile(args.sourcePlan).map(parent => ({ ...parent,
      actualAllowedTextChangeCanAffectDependencies: changedTextNodes.length > 0 && parent.textMutationCanAffectDependencies,
      nativeBeforeEffectDependencyReadbackRequired: parent.reads.length > 0,
      sourceOnlyClosureAvailable: false as const })), gaps: [...gaps].sort(),
    limitations: ["Physical source continuity neither grants modification permission nor authenticates the frozen paper or physical SHA; App ownership/GET boundaries do that independently.",
      "Refined text must retain whole Original meaning through independent semantic evidence. Native per-effect causal data and continuous responsive layout remain separate obligations."] };
}
function textNodes(html: string) {
  const nodes: Array<{ path: string; literal: string; refinableBody: boolean }> = [];
  function walk(node: DefaultTreeAdapterTypes.Node, path: string, insideCard = false, protectedText = false) {
    const element = "tagName" in node ? node : undefined, tag = element?.tagName;
    const classes = element?.attrs.find(attr => attr.name === "class")?.value.split(/\s+/) ?? [];
    const card = insideCard || (tag === "article" && classes.includes("slide-card"));
    const protectedScope = protectedText || Boolean(tag && (/^h[1-6]$/.test(tag) || ["head", "script", "style", "button", "input", "textarea", "select", "a", "summary"].includes(tag)));
    if (node.nodeName === "#text" && "value" in node) { const location = node.sourceCodeLocation; nodes.push({ path, literal: location ? html.slice(location.startOffset, location.endOffset) : node.value, refinableBody: card && !protectedScope && /\S/u.test(node.value) }); }
    if ("childNodes" in node) node.childNodes.forEach((child, index) => walk(child, path + "/" + index, card, protectedScope));
    if (tag === "template" && "content" in node) walk((node as DefaultTreeAdapterTypes.Template).content, path + "/template", card, true);
  }
  walk(parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false }), "0"); return nodes;
}
