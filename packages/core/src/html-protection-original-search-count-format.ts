import { parse } from "@babel/parser";
import { z } from "zod";
import { htmlProtectionInventory, type HtmlProtectionSourceRange } from "./html-protection-inventory";

type Ast = { type: string; start?: number | null; end?: number | null; [key: string]: unknown };
type Gap = { code: string; scriptIndex?: number };
type Template = { prefix: string; separator: string; suffix: string };
type Write = {
  scriptIndex: number; assignmentRange: HtmlProtectionSourceRange; expressionRange: HtmlProtectionSourceRange;
  receiver: { kind: "direct-control" } | { kind: "const-alias"; name: string };
  visibleSlot: { kind: "identifier"; name: string };
  totalSlot: { kind: "member-length"; objectIdentifier: string; property: "length" };
  countTemplate: Template;
};
const inputSchema = z.object({ sourceArtifactId: z.string().min(1).max(512),
  originalSha256: z.string().regex(/^[a-f0-9]{64}$/), html: z.string().min(1).max(20 * 1024 * 1024) }).strict();
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const ast = (value: unknown): Ast | undefined => value && typeof value === "object"
  && "type" in value && typeof value.type === "string" ? value as Ast : undefined;
const identifier = (value: unknown) => ast(value)?.type === "Identifier" ? ast(value)!.name as string : undefined;
const string = (value: unknown) => ast(value)?.type === "StringLiteral" ? ast(value)!.value as string : undefined;
function member(value: unknown) {
  const node = ast(value);
  return node?.type === "MemberExpression" && node.computed === false
    ? { node, object: ast(node.object), property: identifier(node.property) } : undefined;
}
function bindings(value: unknown): Ast[] {
  const node = ast(value); if (!node) return [];
  if (node.type === "Identifier") return [node];
  if (node.type === "RestElement") return bindings(node.argument);
  if (node.type === "AssignmentPattern") return bindings(node.left);
  if (node.type === "ArrayPattern") return (node.elements as unknown[]).flatMap(bindings);
  if (node.type === "ObjectPattern") return (node.properties as unknown[]).flatMap(item => bindings(ast(item)?.type === "RestElement" ? ast(item)!.argument : ast(item)?.value));
  return [];
}
function nodes(root: Ast) {
  const entries: Ast[] = [], parents = new Map<Ast, Ast>(), pending = [root];
  while (pending.length) {
    const node = pending.pop()!; entries.push(node);
    if (entries.length > 200_000) throw Error("AST node budget");
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "extra", "comments", "tokens", "errors"].includes(key)) continue;
      for (const child of (Array.isArray(value) ? value : [value]).map(ast)) if (child) { parents.set(child, node); pending.push(child); }
    }
  }
  return { entries, parents };
}
function format(expression: Ast): Pick<Write, "countTemplate" | "visibleSlot" | "totalSlot"> | undefined {
  let parts: Array<string | Ast>;
  if (expression.type === "TemplateLiteral") {
    const expressions = expression.expressions as unknown[], quasis = expression.quasis as Array<{ value: { cooked: string | null } }>;
    if (expressions.length !== 2 || quasis.length !== 3 || quasis.some(item => typeof item.value.cooked !== "string")) return undefined;
    parts = [quasis[0]!.value.cooked!, ast(expressions[0])!, quasis[1]!.value.cooked!, ast(expressions[1])!, quasis[2]!.value.cooked!];
  } else {
    parts = [];
    const pending = [expression];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.type === "BinaryExpression" && node.operator === "+") pending.push(ast(node.right)!, ast(node.left)!);
      else parts.push(string(node) ?? node);
    }
    // A literal prefix is required; numeric addition cannot be treated as two decimal slots.
    if (typeof parts[0] !== "string") return undefined;
  }
  const slots = parts.filter((item): item is Ast => typeof item !== "string");
  if (slots.length !== 2) return undefined;
  const visible = identifier(slots[0]), total = member(slots[1]), totalName = identifier(total?.object);
  if (!visible || total?.property !== "length" || !totalName || visible === totalName) return undefined;
  const groups = ["", "", ""]; let index = 0;
  for (const part of parts) { if (typeof part === "string") groups[index] += part; else index++; }
  if (new TextEncoder().encode(groups.join("")).byteLength > 1_048_560) return undefined;
  return { countTemplate: { prefix: groups[0]!, separator: groups[1]!, suffix: groups[2]! },
    visibleSlot: { kind: "identifier", name: visible }, totalSlot: { kind: "member-length", objectIdentifier: totalName, property: "length" } };
}

/**
 * Extract a finite Original-only textContent syntax proposal without executing JS.
 * Availability concerns this grammar only. Identifier/length slots are not known native counts:
 * no causality, JS closure, observation authority, physical SHA authentication or verdict follows.
 */
export function htmlProtectionOriginalSearchCountFormat(args: { sourceArtifactId: string; originalSha256: string; html: string }) {
  const parsed = inputSchema.safeParse(args), gaps: Gap[] = [], writes: Write[] = [];
  const gap = (code: string, scriptIndex?: number) => {
    if (!gaps.some(item => item.code === code && item.scriptIndex === scriptIndex)) gaps.push({ code, ...(scriptIndex === undefined ? {} : { scriptIndex }) });
  };
  const result = () => ({ schemaVersion: "html-protection-original-search-count-format-v1" as const,
    ...(parsed.success ? { sourceArtifactId: parsed.data.sourceArtifactId, originalSha256: parsed.data.originalSha256 } : {}),
    availability: !gaps.length && writes.length ? "available" as const : "unavailable" as const,
    ...(!gaps.length && writes.length ? { countTemplate: { ...writes[0]!.countTemplate } } : {}),
    writes, gaps, slotMeaningVerified: false as const, limitations: [
      "Finite inert syntax extraction only: availability is not JS behavior, runtime evidence or a closed protection profile.",
      "Identifier and member-length positions do not establish numeric values, native membership, count causality, semantics or visuals.",
      "Original SHA is independently checked caller metadata; source ranges are decoded UTF-16 offsets, not byte identity or controller provenance.",
      "Reflection, dynamic references, external scripts, alias escape, shadowing and unknown count writes remain unavailable.",
      "Even identical syntax requires independent native observations, unchanged physical inputs and all unresolved protection obligations; no PASS or change permission is produced.",
    ] });
  if (!parsed.success) { gap("invalid-original-count-source"); return result(); }
  let inventory: ReturnType<typeof htmlProtectionInventory>;
  try { inventory = htmlProtectionInventory({ sourceArtifactId: parsed.data.sourceArtifactId, html: parsed.data.html }); }
  catch { gap("original-count-inventory-unavailable"); return result(); }
  if (inventory.parseErrorCount || !Object.values(inventory.explicit).every(tags => tags.startTag && tags.endTag)) gap("original-count-document-uncertainty");
  const controls = inventory.documentElements.filter(element => element.attributes.some(attribute => attribute.name === "id" && attribute.namespace === "" && attribute.value === "searchCount"));
  if (controls.length !== 1 || controls[0]?.inertContext || controls[0]?.namespace !== htmlNamespace) gap("original-count-control-unavailable");
  if (inventory.handlers.length || inventory.references.some(reference => /^\s*javascript:/i.test(reference.value.replace(/[\t\n\r]/g, "")))) gap("original-count-unparsed-executable-reference");
  const all: Array<{ scriptIndex: number; offset: number; entries: Ast[]; parents: Map<Ast, Ast> }> = [];
  for (const script of inventory.scripts) {
    if (script.kind !== "classic" || script.src !== null || !script.hasClosingTag || script.bodyLiteral === null || !script.range || !script.literal) {
      gap("original-count-unknown-script", script.index); continue;
    }
    if (!script.bodyLiteral.trim()) continue;
    const position = script.literal.indexOf(script.bodyLiteral);
    if (position < 0 || position !== script.literal.lastIndexOf(script.bodyLiteral)) { gap("original-count-body-range-ambiguous", script.index); continue; }
    try {
      const tree = parse(script.bodyLiteral, { sourceType: "script", errorRecovery: false, allowReturnOutsideFunction: false });
      all.push({ scriptIndex: script.index, offset: script.range.start + position, ...nodes(tree as unknown as Ast) });
    } catch { gap("original-count-script-parser-unavailable", script.index); }
  }
  const declarations = new Map<string, Ast[]>();
  const register = (node: Ast) => { const name = identifier(node)!; declarations.set(name, [...(declarations.get(name) ?? []), node]); };
  for (const file of all) for (const node of file.entries) {
    if (node.type === "VariableDeclarator") bindings(node.id).forEach(register);
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassDeclaration", "ClassExpression"].includes(node.type)) {
      if (ast(node.id)) bindings(node.id).forEach(register);
      if (Array.isArray(node.params)) node.params.flatMap(bindings).forEach(register);
    }
    if (node.type === "CatchClause") bindings(node.param).forEach(register);
  }
  if (declarations.has("document") || declarations.has("window") || declarations.has("globalThis")) gap("original-count-document-shadowing");
  const aliases = new Map<string, Ast>(), targets = new Set<Ast>(), knownOtherTargets = new Set<Ast>();
  const otherAliases = new Set<string>();
  for (const file of all) for (const node of file.entries) {
    const access = member(node.callee);
    if (node.type !== "CallExpression" || identifier(access?.object) !== "document") continue;
    if (!["getElementById", "querySelector", "querySelectorAll", "addEventListener"].includes(access?.property ?? "")) { gap("original-count-unknown-document-call", file.scriptIndex); continue; }
    if (access?.property === "addEventListener") continue;
    const values = node.arguments as unknown[], selector = string(values[0]);
    if (values.length !== 1 || selector === undefined) { gap("original-count-dynamic-document-reference", file.scriptIndex); continue; }
    const isCount = access?.property === "getElementById" ? selector === "searchCount" : selector === "#searchCount";
    if (!isCount && selector.includes("searchCount")) gap("original-count-unknown-control-selector", file.scriptIndex);
    if (isCount && access?.property === "querySelectorAll") { gap("original-count-ambiguous-control-selector", file.scriptIndex); continue; }
    const literalOtherControl = !isCount && (access?.property === "getElementById"
      || access?.property === "querySelector" && /^#[A-Za-z_][A-Za-z0-9_-]*$/.test(selector));
    if (isCount) targets.add(node); else if (literalOtherControl) knownOtherTargets.add(node);
    const parent = file.parents.get(node), declaration = parent?.type === "VariableDeclarator" ? parent : undefined;
    if (declaration && identifier(declaration.id)) {
      const name = identifier(declaration.id)!, statement = file.parents.get(declaration);
      if (isCount) {
        if (statement?.type !== "VariableDeclaration" || statement.kind !== "const" || declarations.get(name)?.length !== 1) gap("original-count-alias-rebinding", file.scriptIndex);
        else aliases.set(name, ast(declaration.id)!);
      } else if (literalOtherControl && statement?.type === "VariableDeclaration" && statement.kind === "const" && declarations.get(name)?.length === 1) otherAliases.add(name);
    } else if (isCount && (parent?.type !== "MemberExpression" || parent.object !== node)) gap("original-count-alias-escape", file.scriptIndex);
  }
  const callableNames = new Set<string>(), collections = new Set<string>(), strings = new Set<string>();
  for (const file of all) for (const node of file.entries) {
    if (node.type === "FunctionDeclaration" && identifier(node.id)) callableNames.add(identifier(node.id)!);
    if (node.type !== "VariableDeclarator" || !identifier(node.id) || file.parents.get(node)?.kind !== "const") continue;
    const name = identifier(node.id)!, initializer = ast(node.init), called = member(initializer?.callee);
    if (["FunctionExpression", "ArrowFunctionExpression"].includes(initializer?.type ?? "")) callableNames.add(name);
    if (initializer?.type === "ArrayExpression") collections.add(name);
    if (initializer?.type === "StringLiteral") strings.add(name);
    if (initializer?.type === "CallExpression" && identifier(called?.object) === "Array" && called?.property === "from") {
      const values = initializer.arguments as unknown[], source = ast(values[0]), lookup = member(source?.callee);
      if (values.length === 1 && (source?.type === "ArrayExpression" || source?.type === "StringLiteral"
        || source?.type === "CallExpression" && identifier(lookup?.object) === "document" && lookup?.property === "querySelectorAll"
          && (source.arguments as unknown[]).length === 1 && string((source.arguments as unknown[])[0]) !== undefined)) collections.add(name);
    }
  }
  if (declarations.has("Array") || declarations.has("Object")) gap("original-count-native-global-shadowing");
  const knownCallback = (value: unknown) => ["FunctionExpression", "ArrowFunctionExpression"].includes(ast(value)?.type ?? "")
    || identifier(value) !== undefined && callableNames.has(identifier(value)!) && declarations.get(identifier(value)!)?.length === 1;
  for (const file of all) for (const node of file.entries) {
    const parent = file.parents.get(node), access = member(node);
    if (node.type === "AssignmentExpression" && callableNames.has(identifier(node.left) ?? "")
      || node.type === "UpdateExpression" && callableNames.has(identifier(node.argument) ?? "")) gap("original-count-callable-rebinding", file.scriptIndex);
    if (node.type === "Identifier" && identifier(node) === "Array"
      && !(parent?.type === "MemberExpression" && parent.object === node && !parent.computed && identifier(parent.property) === "from"
        && file.parents.get(parent)?.type === "CallExpression" && file.parents.get(parent)?.callee === parent)) gap("original-count-native-global-escape", file.scriptIndex);
    if (node.type === "Identifier" && ["eval", "Function", "globalThis", "Proxy", "Reflect"].includes(identifier(node)!)) gap("original-count-reflective-reference", file.scriptIndex);
    if (["ImportExpression", "WithStatement", "NewExpression", "OptionalCallExpression", "OptionalMemberExpression"].includes(node.type)) gap("original-count-dynamic-execution", file.scriptIndex);
    if (["prototype", "__proto__", "constructor"].includes(access?.property ?? "")) gap("original-count-reflective-reference", file.scriptIndex);
    if (node.type === "CallExpression") {
      const called = member(node.callee);
      if (identifier(called?.object) === "Object" || identifier(called?.object) === "window" && called?.property !== "addEventListener") gap("original-count-reflective-reference", file.scriptIndex);
      const name = identifier(node.callee);
      const syntacticMemberCall = called && (
        identifier(called.object) === "document" && ["getElementById", "querySelector", "querySelectorAll", "addEventListener"].includes(called.property ?? "")
        || identifier(called.object) === "Array" && called.property === "from"
        || identifier(called.object) === "window" && called.property === "addEventListener"
        || collections.has(identifier(called.object) ?? "") && declarations.get(identifier(called.object)!)?.length === 1 && ["forEach", "filter", "map", "includes"].includes(called.property ?? "")
        || strings.has(identifier(called.object) ?? "") && declarations.get(identifier(called.object)!)?.length === 1 && ["includes", "toLowerCase", "trim"].includes(called.property ?? "")
        || otherAliases.has(identifier(called.object) ?? "") && called.property === "addEventListener"
      );
      const values = node.arguments as unknown[];
      if (["forEach", "filter", "map"].includes(called?.property ?? "") && (values.length !== 1 || !knownCallback(values[0]))) gap("original-count-unknown-callback-reference", file.scriptIndex);
      if (called?.property === "addEventListener" && (values.length !== 2 || string(values[0]) === undefined || !knownCallback(values[1]))) gap("original-count-unknown-callback-reference", file.scriptIndex);
      if (called?.property === "from" && identifier(called.object) === "Array") {
        const source = ast(values[0]), lookup = member(source?.callee);
        if (!(values.length === 1 && (source?.type === "ArrayExpression" || source?.type === "StringLiteral"
          || source?.type === "CallExpression" && identifier(lookup?.object) === "document" && lookup?.property === "querySelectorAll"
            && (source.arguments as unknown[]).length === 1 && string((source.arguments as unknown[])[0]) !== undefined))) gap("original-count-unknown-collection-reference", file.scriptIndex);
      }
      if (!(name && callableNames.has(name) && declarations.get(name)?.length === 1) && !syntacticMemberCall) gap("original-count-unknown-call-reference", file.scriptIndex);
    }
    if (node.type === "Identifier" && identifier(node) === "window"
      && !(parent?.type === "MemberExpression" && parent.object === node && !parent.computed && identifier(parent.property) === "addEventListener"
        && file.parents.get(parent)?.type === "CallExpression" && file.parents.get(parent)?.callee === parent)) gap("original-count-window-escape", file.scriptIndex);
    if (node.type === "Identifier" && identifier(node) === "document"
      && !(parent?.type === "MemberExpression" && parent.object === node && !parent.computed
        && file.parents.get(parent)?.type === "CallExpression" && file.parents.get(parent)?.callee === parent)) gap("original-count-document-escape", file.scriptIndex);
    if (node.type === "Identifier" && aliases.has(identifier(node)!) && node !== aliases.get(identifier(node)!)
      && !(parent?.type === "MemberExpression" && parent.object === node && !parent.computed && parent.property && identifier(parent.property) === "textContent")) gap("original-count-alias-escape", file.scriptIndex);
    if (!access) {
      if (node.type === "MemberExpression" && (targets.has(ast(node.object)!) || aliases.has(identifier(node.object) ?? ""))) gap("original-count-unknown-property-reference", file.scriptIndex);
      continue;
    }
    if ((parent?.type === "AssignmentExpression" && parent.left === node || parent?.type === "UpdateExpression" && parent.argument === node)
      && (collections.has(identifier(access.object) ?? "") || strings.has(identifier(access.object) ?? ""))) gap("original-count-native-method-rebinding", file.scriptIndex);
    const receiver = targets.has(access.object!) ? { kind: "direct-control" as const }
      : aliases.has(identifier(access.object) ?? "") ? { kind: "const-alias" as const, name: identifier(access.object)! } : undefined;
    if (!receiver) {
      if (["textContent", "innerHTML", "outerHTML"].includes(access.property ?? "") && parent?.type === "AssignmentExpression" && parent.left === node
        && !knownOtherTargets.has(access.object!) && !otherAliases.has(identifier(access.object) ?? "")) gap("original-count-unknown-write-reference", file.scriptIndex);
      continue;
    }
    if (access.property !== "textContent" || parent?.type !== "AssignmentExpression" || parent.operator !== "=" || parent.left !== node) {
      gap("original-count-unknown-property-reference", file.scriptIndex); continue;
    }
    const expression = ast(parent.right), recognized = expression && format(expression);
    if (!recognized || parent.start == null || parent.end == null || expression?.start == null || expression.end == null) { gap("original-count-format-unavailable", file.scriptIndex); continue; }
    if (declarations.get(recognized.visibleSlot.name)?.length !== 1 || declarations.get(recognized.totalSlot.objectIdentifier)?.length !== 1) gap("original-count-slot-binding-ambiguous", file.scriptIndex);
    writes.push({ scriptIndex: file.scriptIndex,
      assignmentRange: { start: file.offset + parent.start, end: file.offset + parent.end },
      expressionRange: { start: file.offset + expression.start, end: file.offset + expression.end }, receiver, ...recognized });
  }
  if (!writes.length) gap("original-count-writer-unavailable");
  if (writes.some(write => JSON.stringify({ format: write.countTemplate, visible: write.visibleSlot, total: write.totalSlot })
    !== JSON.stringify({ format: writes[0]!.countTemplate, visible: writes[0]!.visibleSlot, total: writes[0]!.totalSlot }))) gap("original-count-distinct-writes");
  return result();
}
