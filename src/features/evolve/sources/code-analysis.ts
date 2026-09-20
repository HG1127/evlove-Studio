import { parse } from "@babel/parser";

export type CodeFileAnalysis = {
  path: string;
  language: string;
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
  jsxTags: string[];
  routeHints: string[];
  parseOk: boolean;
  parseError?: string;
};

function languageFrom(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const mapped = ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript" } as Record<string, string>)[ext];
  return mapped ?? (ext || "text");
}

function walk(node: unknown, visit: (value: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.type === "string") visit(record);
  for (const [key, value] of Object.entries(record)) {
    if (["loc", "start", "end", "extra", "tokens", "comments"].includes(key)) continue;
    if (Array.isArray(value)) for (const item of value) walk(item, visit);
    else if (value && typeof value === "object") walk(value, visit);
  }
}

function nodeName(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === "Identifier" && typeof record.name === "string") return record.name;
  if (record.type === "StringLiteral" && typeof record.value === "string") return record.value;
  if (record.type === "JSXIdentifier" && typeof record.name === "string") return record.name;
  return undefined;
}

export function analyzeCodeFile(path: string, content: string): CodeFileAnalysis {
  const imports = new Set<string>();
  const exports = new Set<string>();
  const functions = new Set<string>();
  const classes = new Set<string>();
  const jsxTags = new Set<string>();
  const routeHints = new Set<string>();
  const language = languageFrom(path);
  if (!["typescript", "tsx", "javascript", "jsx"].includes(language)) {
    const genericFunctions = [...content.matchAll(/(?:function|def|func|fn)\s+([A-Za-z_$][\w$]*)/g)].map((m)=>m[1]!).slice(0,80);
    return { path, language, imports: [], exports: [], functions: genericFunctions, classes: [...content.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)].map((m)=>m[1]!).slice(0,50), jsxTags: [], routeHints: [], parseOk: true };
  }
  try {
    const ast = parse(content, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: ["jsx", "typescript", "decorators-legacy", "classProperties", "dynamicImport", "topLevelAwait"],
    });
    walk(ast, (node) => {
      if (node.type === "ImportDeclaration") {
        const source = node.source as Record<string, unknown> | undefined;
        if (typeof source?.value === "string") imports.add(source.value);
      }
      if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
        const declaration = node.declaration as Record<string, unknown> | undefined;
        const name = nodeName(declaration?.id);
        exports.add(name ?? (node.type === "ExportDefaultDeclaration" ? "default" : "named"));
      }
      if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(String(node.type))) {
        const name = nodeName((node as Record<string, unknown>).id);
        if (name) functions.add(name);
      }
      if (node.type === "ClassDeclaration") {
        const name = nodeName(node.id);
        if (name) classes.add(name);
      }
      if (node.type === "JSXOpeningElement") {
        const name = nodeName(node.name);
        if (name) jsxTags.add(name);
      }
      if (node.type === "CallExpression") {
        const callee = node.callee as Record<string, unknown> | undefined;
        const property = callee?.property as Record<string, unknown> | undefined;
        const calleeName = nodeName(callee) ?? nodeName(property);
        if (calleeName && /route|router|navigate|push|useRoute|createBrowserRouter/i.test(calleeName)) routeHints.add(calleeName);
      }
    });
    return { path, language, imports: [...imports].slice(0,100), exports: [...exports].slice(0,100), functions: [...functions].slice(0,100), classes: [...classes].slice(0,80), jsxTags: [...jsxTags].slice(0,100), routeHints: [...routeHints].slice(0,60), parseOk: true };
  } catch (error) {
    return { path, language, imports: [], exports: [], functions: [], classes: [], jsxTags: [], routeHints: [], parseOk: false, parseError: error instanceof Error ? error.message : String(error) };
  }
}
