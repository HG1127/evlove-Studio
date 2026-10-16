import { parse, type DefaultTreeAdapterTypes } from "parse5";
import type { HtmlProtectionWholeRuntimeSourcePlan } from "@evolution/contracts";
import { htmlProtectionInventory } from "./html-protection-inventory";

/** Physical subject occurrence/location. Parent authority remains in the complete Original source plan. */
export function htmlProtectionWholeSubjectScriptLocations(args: { sourcePlan: HtmlProtectionWholeRuntimeSourcePlan; html: string }) {
  const inventory = htmlProtectionInventory({ sourceArtifactId: args.sourcePlan.original.sourceArtifactId, html: args.html });
  const locations = new Map<number, { line: number; column: number }>();
  function walk(node: DefaultTreeAdapterTypes.Node) {
    if ("tagName" in node && node.tagName === "script" && node.sourceCodeLocation?.startTag) {
      const location = node.sourceCodeLocation;
      locations.set(location.startOffset, { line: location.startTag!.endLine - 1, column: location.startTag!.endCol - 1 });
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
    if ("tagName" in node && node.tagName === "template" && "content" in node) (node as DefaultTreeAdapterTypes.Template).content.childNodes.forEach(walk);
  }
  walk(parse(args.html, { sourceCodeLocationInfo: true, scriptingEnabled: false }));
  const actual = inventory.scripts.filter(script => script.potentialExecutable || script.runtimeConfiguration || script.activationUnresolved);
  if (actual.length !== args.sourcePlan.scriptShape.length) throw Error("Physical subject script occurrence set differs from Original");
  return actual.map((script, index) => {
    const source = args.sourcePlan.scriptShape[index]!, location = script.range && locations.get(script.range.start);
    const literal = script.bodyLiteral?.replace(/\r\n?/g, "\n");
    if (!location || script.src || script.kind !== "classic" || source.kind !== script.kind || literal === undefined || literal !== source.literal?.replace(/\r\n?/g, "\n")) throw Error("Physical subject script source/activation differs from Original");
    return { parentId: source.id, sourcePath: source.sourcePath, subjectSourcePath: script.path, line: location.line, column: location.column, sourceCharacters: literal.length };
  });
}
