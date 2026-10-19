import { parse } from "@babel/parser";

export type HtmlProtectionScriptEffect = {
  id: string; kind: "selector" | "event" | "timer" | "intersection" | "dom-write" | "clipboard" | "scroll" | "unknown";
  sourceRange: { start: number; end: number }; ownerFunctionId: string; branchIds: string[];
  expression: unknown; literalSelector?: string; eventType?: string; delayMs?: number;
};
const writes = new Set(["add", "remove", "toggle", "replace", "appendChild", "removeChild", "replaceChild", "append", "prepend", "after", "before",
  "replaceWith", "insertBefore", "insertAdjacentElement", "insertAdjacentHTML", "insertAdjacentText", "setAttribute", "removeAttribute", "toggleAttribute",
  "setProperty", "removeProperty", "write", "writeln", "attachShadow"]);
const recognizedPure = new Set(["closest", "matches", "contains", "getAttribute", "createElement", "createTextNode", "cloneNode", "forEach", "map", "flatMap", "filter",
  "find", "some", "every", "sort", "slice", "split", "join", "push", "shift", "trim", "toLowerCase", "replace", "normalize", "includes", "test", "padStart", "String", "then",
  "getBoundingClientRect", "getComputedStyle", "from", "keys", "values", "entries", "isArray", "parse", "stringify", "observe", "unobserve", "disconnect"]);
/** Full AST and full effect classification are different facts; neither grants executed or whole-parent authority. */
export function htmlProtectionScriptEffectProfile(args: { parentId: string; literal: string | null }) {
  const effects: HtmlProtectionScriptEffect[] = [], branches: Array<{ id: string; kind: string; sourceRange: { start: number; end: number }; test: unknown }> = [];
  const functions: Array<{ id: string; sourceRange: { start: number; end: number }; parameters: unknown[] }> = [];
  const gaps = new Set<string>(); let astNodeCount = 0, unclassifiedCallCount = 0;
  if (args.literal === null) return { parentId: args.parentId, completeSourceGraph: false, completeEffectClassification: false, astNodeCount, effects, branches, functions, gaps: ["missing-complete-script-source"] };
  try {
    const ast = parse(args.literal, { sourceType: "unambiguous" }), localFunctions = new Set<string>();
    const clean = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(clean);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value).filter(([key]) => !["loc", "comments", "leadingComments", "trailingComments", "innerComments", "extra", "start", "end"].includes(key)).map(([key, item]) => [key, clean(item)]));
    };
    const range = (node: Record<string, unknown>) => {
      if (!Number.isSafeInteger(node.start) || !Number.isSafeInteger(node.end) || Number(node.start) < 0 || Number(node.end) > args.literal!.length || Number(node.end) <= Number(node.start)) throw Error("source-range-unavailable");
      return { start: Number(node.start), end: Number(node.end) };
    };
    const name = (node: Record<string, unknown> | undefined): string | undefined => node?.type === "Identifier" ? String(node.name)
      : ["MemberExpression", "OptionalMemberExpression"].includes(String(node?.type)) && !node?.computed ? String((node?.property as Record<string, unknown>)?.name) : undefined;
    const literal = (node: Record<string, unknown> | undefined) => node?.type === "StringLiteral" ? String(node.value) : undefined;
    function findLocals(value: unknown) {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>;
      if (node.type === "FunctionDeclaration") { const id = name(node.id as Record<string, unknown>); if (id) localFunctions.add(id); }
      if (node.type === "VariableDeclarator" && ["FunctionExpression", "ArrowFunctionExpression"].includes(String((node.init as Record<string, unknown>)?.type))) { const id = name(node.id as Record<string, unknown>); if (id) localFunctions.add(id); }
      for (const [key, item] of Object.entries(node)) if (!["loc", "comments", "extra"].includes(key)) { if (Array.isArray(item)) item.forEach(findLocals); else if (item && typeof item === "object") findLocals(item); }
    }
    findLocals(ast);
    function walk(value: unknown, ownerFunctionId = args.parentId + ":boot", ancestors: string[] = []) {
      if (!value || typeof value !== "object") return;
      const node = value as Record<string, unknown>; if (typeof node.type !== "string") return;
      if (++astNodeCount > 100_000) throw Error("source-profile-capacity");
      let owner = ownerFunctionId, branchIds = ancestors;
      if (["FunctionExpression", "FunctionDeclaration", "ArrowFunctionExpression"].includes(node.type)) {
        owner = args.parentId + ":function:" + functions.length;
        functions.push({ id: owner, sourceRange: range(node), parameters: clean(node.params) as unknown[] });
      }
      if (["IfStatement", "ConditionalExpression", "LogicalExpression", "SwitchStatement", "ForStatement", "ForOfStatement", "ForInStatement", "WhileStatement", "DoWhileStatement", "TryStatement", "OptionalCallExpression", "OptionalMemberExpression"].includes(node.type)) {
        const id = args.parentId + ":branch:" + branches.length;
        branches.push({ id, kind: node.type, sourceRange: range(node), test: clean(node.test ?? node.discriminant ?? node.right ?? node.left ?? node.object ?? node.callee ?? null) });
        branchIds = [...ancestors, id];
      }
      const add = (kind: HtmlProtectionScriptEffect["kind"], fields: Partial<HtmlProtectionScriptEffect> = {}) => effects.push({
        id: args.parentId + ":effect:" + effects.length, kind, sourceRange: range(node), ownerFunctionId: owner, branchIds: [...branchIds], expression: clean(node), ...fields });
      if (["CallExpression", "NewExpression", "OptionalCallExpression"].includes(node.type)) {
        const callee = node.callee as Record<string, unknown>, called = name(callee), values = node.arguments as Array<Record<string, unknown>>;
        let classified = false;
        if (["querySelector", "querySelectorAll", "getElementById", "$", "$$", "qs", "qsa"].includes(called ?? "")) { classified = true; add("selector", literal(values[0]) === undefined ? {} : { literalSelector: literal(values[0]) }); }
        if (called === "addEventListener") {
          classified = true; const eventType = literal(values[0]); add("event", eventType === undefined ? {} : { eventType });
          if (!eventType || !["click", "input", "scroll"].includes(eventType)) gaps.add("event-domain-unresolved");
          if (!["ArrowFunctionExpression", "FunctionExpression"].includes(String(values[1]?.type))) gaps.add("event-callback-binding-unresolved");
        }
        if (["setTimeout", "setInterval", "requestAnimationFrame"].includes(called ?? "")) {
          classified = true; const delayMs = values[1]?.type === "NumericLiteral" ? Number(values[1].value) : undefined; add("timer", delayMs === undefined ? {} : { delayMs });
          if (called !== "setTimeout" || delayMs === undefined || delayMs < 0 || delayMs > 7000) gaps.add("temporal-domain-unresolved");
        }
        if (called === "IntersectionObserver") { classified = true; add("intersection"); }
        if (called === "writeText") { classified = true; add("clipboard"); }
        if (["scrollTo", "scrollBy", "scrollIntoView"].includes(called ?? "")) { classified = true; add("scroll"); }
        if (writes.has(called ?? "")) { classified = true; add("dom-write");
          if (called === "attachShadow" || ["write", "writeln", "insertAdjacentHTML"].includes(called ?? "")) gaps.add("dynamic-document-write-domain");
          if (called === "setAttribute" && (literal(values[0]) === undefined || /^(src|href|srcdoc|on.*)$/i.test(literal(values[0])!))) gaps.add("unsafe-or-external-write-domain");
        }
        if (["fetch", "eval", "Function", "WebSocket", "Worker", "SharedWorker", "sendBeacon", "importScripts", "open", "defineProperty", "defineProperties", "setPrototypeOf"].includes(called ?? "")) { classified = true; add("unknown"); gaps.add("external-or-dynamic-execution-domain"); }
        // A parsed local body remains in the graph. This classification is not a receiver/native identity proof.
        if (recognizedPure.has(called ?? "") || (callee?.type === "Identifier" && localFunctions.has(called!)) || ["FunctionExpression", "ArrowFunctionExpression"].includes(String(callee?.type))) classified = true;
        if (!classified) { add("unknown"); unclassifiedCallCount++; gaps.add("unclassified-source-call-domain"); }
      }
      if (["ImportDeclaration", "ImportExpression", "WithStatement", "TaggedTemplateExpression", "DebuggerStatement", "AwaitExpression", "YieldExpression"].includes(node.type)) { add("unknown"); gaps.add("external-or-dynamic-execution-domain"); }
      if (node.type === "AssignmentExpression" || node.type === "UpdateExpression" || (node.type === "UnaryExpression" && node.operator === "delete")) {
        const target = (node.left ?? node.argument) as Record<string, unknown>;
        if (["MemberExpression", "OptionalMemberExpression"].includes(String(target?.type))) {
          add("dom-write");
          if (target.computed || ["src", "href", "location", "cookie", "prototype", "__proto__"].includes(name(target) ?? "")) gaps.add("unsafe-or-external-write-domain");
        }
      }
      for (const [key, item] of Object.entries(node)) if (!["loc", "comments", "leadingComments", "trailingComments", "innerComments", "extra"].includes(key)) {
        if (Array.isArray(item)) item.forEach(child => walk(child, owner, branchIds)); else if (item && typeof item === "object") walk(item, owner, branchIds);
      }
    }
    walk(ast);
    return { parentId: args.parentId, completeSourceGraph: true, completeEffectClassification: unclassifiedCallCount === 0 && !effects.some(effect => effect.kind === "unknown"), astNodeCount, effects, branches, functions, gaps: [...gaps].sort(),
      obligations: effects.map(effect => ({ id: effect.id, parentId: args.parentId, ownerFunctionId: effect.ownerFunctionId,
        branchIds: effect.branchIds, sourceRange: effect.sourceRange, kind: effect.kind, support: "unresolved" as const })) };
  } catch { gaps.add("complete-script-source-graph-unavailable"); return { parentId: args.parentId, completeSourceGraph: false, completeEffectClassification: false, astNodeCount, effects, branches, functions, gaps: [...gaps].sort() }; }
}
