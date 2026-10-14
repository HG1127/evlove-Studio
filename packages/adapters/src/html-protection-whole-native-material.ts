import { z } from "zod";
import { HTML_PROTECTION_WHOLE_RUNTIME_LIMITS as limits } from "@evolution/contracts";
const index = z.number().int().nonnegative(), bounds = z.array(z.number().finite()).length(4);
export const HtmlProtectionWholeNativeStyleTableSchema = z.object({ strings: z.array(z.string()), styleRows: z.array(z.array(z.tuple([index, index])).max(limits.properties)),
  elements: z.array(z.object({ sourcePath: z.string().min(1).max(2048), tag: z.string().min(1), id: z.string().nullable(), namespace: z.string().nullable(), bounds,
    styles: index, beforeStyles: index, afterStyles: index, markerStyles: index }).strict()).max(limits.nodes) }).strict().superRefine((value, ctx) => {
  if (new Set(value.elements.map(element => element.sourcePath)).size !== value.elements.length
    || value.elements.some(element => [element.styles, element.beforeStyles, element.afterStyles, element.markerStyles].some(index => index >= value.styleRows.length))
    || value.styleRows.some(row => new Set(row.map(pair => pair[0])).size !== row.length || row.some(pair => pair.some(index => index >= value.strings.length)))) ctx.addIssue({ code: "custom", message: "Full native all-element style references required" });
});
export function validateHtmlProtectionWholeNativeDocument(value: unknown, frameId: string) {
  const material = z.object({ elementCount: z.number().int().positive().max(limits.nodes), styleTable: HtmlProtectionWholeNativeStyleTableSchema, snapshot: z.unknown() }).strict().parse(value);
  const snapshot = z.object({ strings: z.array(z.string()), documents: z.array(z.object({ frameId: index,
    nodes: z.object({ parentIndex: z.array(z.number().int()), nodeType: z.array(z.number().int().positive()), nodeName: z.array(index), nodeValue: z.array(z.number().int().min(-1)),
      backendNodeId: z.array(z.number().int().positive()), attributes: z.array(z.array(index)), pseudoType: z.object({ index: z.array(index), value: z.array(index) }).strict().optional() }).passthrough(),
    layout: z.object({ nodeIndex: z.array(index), styles: z.array(z.array(z.number().int())), bounds: z.array(bounds), text: z.array(z.number().int()) }).passthrough() }).passthrough()).length(1) }).passthrough().parse(material.snapshot);
  const document = snapshot.documents[0]!, nodes = document.nodes, layout = document.layout;
  if (snapshot.strings[document.frameId] !== frameId || !nodes.nodeType.length || nodes.nodeType.length > limits.nodes || material.elementCount !== material.styleTable.elements.length
    || Object.values(nodes).some(value => Array.isArray(value) && value.length !== nodes.nodeType.length) || new Set(nodes.backendNodeId).size !== nodes.nodeType.length
    || nodes.parentIndex.some((parent, index) => parent < -1 || parent >= index) || nodes.nodeName.some(index => index >= snapshot.strings.length) || nodes.nodeValue.some(index => index >= snapshot.strings.length)
    || nodes.attributes.some(row => row.length % 2 || row.some(index => index >= snapshot.strings.length))
    || layout.nodeIndex.length !== layout.styles.length || layout.nodeIndex.length !== layout.bounds.length || layout.nodeIndex.length !== layout.text.length
    || layout.nodeIndex.some(index => index >= nodes.nodeType.length) || layout.styles.some(row => row.length) || layout.text.some(index => index < -1 || index >= snapshot.strings.length)) throw Error("Whole native complete DOM/layout/style material inconsistent");
  // Any shadow roots or embedded document state requires explicit source/runtime domain support instead of silent flattening.
  const pseudos = new Set(nodes.pseudoType?.index ?? []);
  if (nodes.pseudoType && (nodes.pseudoType.index.length !== nodes.pseudoType.value.length || nodes.pseudoType.index.some(index => index >= nodes.nodeType.length) || nodes.pseudoType.value.some(index => index >= snapshot.strings.length))) throw Error("Whole native generated pseudo scope inconsistent");
  if ((nodes.pseudoType?.value ?? []).some(index => !["before", "after", "marker"].includes(snapshot.strings[index]!))) throw Error("Whole native additional active pseudo domain unobserved");
  if (nodes.nodeType.filter((type, index) => type === 1 && !pseudos.has(index)).length !== material.elementCount) throw Error("Whole native element census differs from complete DOM snapshot");
  return material;
}
