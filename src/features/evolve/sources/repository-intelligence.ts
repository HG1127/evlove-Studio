import type { EvolveProject, SourceArtifact } from "../schemas";
import type { CodeFileAnalysis as CodeAnalysis } from "./code-analysis";

export type RepositoryEntry = {
  path: string;
  family: string;
  role?: string;
  content?: string;
  sizeChars?: number;
};

export type RepositoryDependencyEdge = {
  from: string;
  importSpec: string;
  to?: string;
  kind: "internal" | "external" | "unresolved-internal";
};

export type RepositoryCriticalModule = {
  path: string;
  score: number;
  reasons: string[];
  parseOk?: boolean;
};

export type RepositoryRequirementAnchor = {
  id: string;
  label: string;
  query: string;
  tokens: string[];
  evidencePaths: string[];
  coverage: number;
};

export type RepositoryIntelligence = {
  kind: "repository-intelligence";
  totalEntries: number;
  eligibleEntries: number;
  deepIndexedEntries: number;
  codeFiles: number;
  parsedCodeFiles: number;
  indexedSymbols: number;
  internalImports: number;
  resolvedInternalImports: number;
  dependencyEdges: RepositoryDependencyEdge[];
  entrypoints: string[];
  criticalModules: RepositoryCriticalModule[];
  featureClusters: Array<{ id: string; label: string; paths: string[] }>;
  generatedAt: string;
};

const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss"];

function normalizePath(value: string) {
  const out: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop(); else out.push(part);
  }
  return out.join("/");
}

function dirname(value: string) {
  const normalized = normalizePath(value);
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
}

function fileCandidates(base: string) {
  const normalized = normalizePath(base).replace(/\/$/, "");
  const candidates = [normalized];
  if (!/\.[a-z0-9]+$/i.test(normalized)) {
    for (const ext of CODE_EXTS) candidates.push(normalized + ext);
    for (const ext of CODE_EXTS) candidates.push(`${normalized}/index${ext}`);
  }
  return candidates;
}

function resolveImport(from: string, spec: string, paths: Set<string>) {
  let base: string | undefined;
  if (spec.startsWith(".")) base = normalizePath(`${dirname(from)}/${spec}`);
  else if (spec.startsWith("@/")) base = normalizePath(`src/${spec.slice(2)}`);
  else if (spec.startsWith("~/")) base = normalizePath(`src/${spec.slice(2)}`);
  else if (spec.startsWith("src/")) base = normalizePath(spec);
  else return { kind: "external" as const };
  for (const candidate of fileCandidates(base)) if (paths.has(candidate)) return { kind: "internal" as const, path: candidate };
  return { kind: "unresolved-internal" as const };
}

function symbolCount(analysis: CodeAnalysis) {
  return analysis.exports.length + analysis.functions.length + analysis.classes.length + analysis.jsxTags.length + analysis.routeHints.length;
}

function roleWeight(role?: string) {
  if (role === "implementation") return 5;
  if (role === "configuration") return 5;
  if (role === "content") return 3;
  if (role === "documentation") return 1;
  if (role === "test-evidence") return -2;
  if (role === "reference-evidence") return -2;
  return 0;
}

function criticalScore(entry: RepositoryEntry, analysis: CodeAnalysis | undefined, inbound: number, outbound: number) {
  const path = entry.path.toLowerCase();
  let score = roleWeight(entry.role) + Math.min(8, inbound * 0.8) + Math.min(5, outbound * 0.5);
  const reasons: string[] = [];
  const add = (value: number, reason: string) => { score += value; reasons.push(reason); };
  if (/(^|\/)(package\.json|vite\.config\.|tsconfig|pyproject\.toml|go\.mod|cargo\.toml)/.test(path)) add(8, "工程入口/配置");
  if (/(^|\/)(main|app|index|router|routes?)\.(ts|tsx|js|jsx)$/.test(path)) add(7, "应用入口/路由");
  if (/workflow|runtime|orchestr|state|stage|gate|campaign/.test(path)) add(6, "流程/运行时核心");
  if (/source|extract|parser|artifact|upload|composer|input/.test(path)) add(6, "成果物输入/解析核心");
  if (/acceptance|eval|validation|evidence|judge/.test(path)) add(5, "验证/证据核心");
  if (/project-studio|stage-panels|dashboard|settings|overview/.test(path)) add(4, "主要产品界面");
  if (/provider|model|ai\/|gateway/.test(path)) add(3, "AI/模型连接");
  if (analysis?.routeHints.length) add(3, "路由调用");
  if (analysis?.exports.length && inbound > 0) reasons.push(`被 ${inbound} 个内部依赖引用`);
  if (outbound > 0) reasons.push(`${outbound} 个内部依赖`);
  return { score, reasons };
}

function clusterForPath(path: string) {
  const parts = normalizePath(path).split("/");
  const featureIndex = parts.indexOf("features");
  if (featureIndex >= 0 && parts[featureIndex + 1]) return `feature:${parts[featureIndex + 1]}`;
  const srcIndex = parts.indexOf("src");
  if (srcIndex >= 0 && parts[srcIndex + 1]) return `src:${parts[srcIndex + 1]}`;
  return parts.length > 1 ? `root:${parts[0]}` : "root";
}

export function buildRepositoryIntelligence(args: { entries: RepositoryEntry[]; codeAnalyses: CodeAnalysis[]; totalEntries?: number }): RepositoryIntelligence {
  const entries = args.entries;
  const paths = new Set(entries.map((entry) => normalizePath(entry.path)));
  const analysisByPath = new Map(args.codeAnalyses.map((analysis) => [normalizePath(analysis.path), analysis]));
  const edges: RepositoryDependencyEdge[] = [];
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const analysis of args.codeAnalyses) {
    for (const spec of analysis.imports) {
      const resolved = resolveImport(analysis.path, spec, paths);
      edges.push({ from: analysis.path, importSpec: spec, to: resolved.kind === "internal" ? resolved.path : undefined, kind: resolved.kind });
      if (resolved.kind === "internal" && resolved.path) {
        inbound.set(resolved.path, (inbound.get(resolved.path) ?? 0) + 1);
        outbound.set(analysis.path, (outbound.get(analysis.path) ?? 0) + 1);
      }
    }
  }
  const critical = entries
    .filter((entry) => ["implementation", "configuration", "content"].includes(entry.role ?? "") || entry.family === "code")
    .map((entry) => {
      const analysis = analysisByPath.get(normalizePath(entry.path));
      const result = criticalScore(entry, analysis, inbound.get(entry.path) ?? 0, outbound.get(entry.path) ?? 0);
      return { path: entry.path, score: Number(result.score.toFixed(2)), reasons: result.reasons, parseOk: analysis?.parseOk };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 32);
  const entrypoints = critical.filter((item) => /入口|路由/.test(item.reasons.join(" "))).map((item) => item.path).slice(0, 16);
  const clustersMap = new Map<string, string[]>();
  for (const entry of entries.filter((item) => item.role !== "test-evidence" && item.role !== "reference-evidence")) {
    const id = clusterForPath(entry.path);
    const list = clustersMap.get(id) ?? [];
    if (list.length < 80) list.push(entry.path);
    clustersMap.set(id, list);
  }
  const featureClusters = [...clustersMap.entries()].map(([id, clusterPaths]) => ({ id, label: id.replace(/^feature:|^src:|^root:/, ""), paths: clusterPaths })).sort((a, b) => b.paths.length - a.paths.length).slice(0, 24);
  const internal = edges.filter((edge) => edge.kind !== "external");
  const resolved = edges.filter((edge) => edge.kind === "internal");
  return {
    kind: "repository-intelligence",
    totalEntries: args.totalEntries ?? entries.length,
    eligibleEntries: entries.filter((entry) => Boolean(entry.content) || entry.family === "code").length,
    deepIndexedEntries: entries.filter((entry) => Boolean(entry.content)).length,
    codeFiles: args.codeAnalyses.length,
    parsedCodeFiles: args.codeAnalyses.filter((analysis) => analysis.parseOk).length,
    indexedSymbols: args.codeAnalyses.reduce((sum, analysis) => sum + symbolCount(analysis), 0),
    internalImports: internal.length,
    resolvedInternalImports: resolved.length,
    dependencyEdges: edges.slice(0, 1200),
    entrypoints,
    criticalModules: critical,
    featureClusters,
    generatedAt: new Date().toISOString(),
  };
}

const GOAL_PRESETS: Array<{ id: string; label: string; pattern: RegExp; query: string }> = [
  { id: "input-compat", label: "成果物输入兼容", pattern: /成果物|输入兼容|上传|附件|解析|parser|artifact|zip|ppt|excel|word|pdf/i, query: "upload ingest source artifact parser extract compatibility zip pptx xlsx docx input attachment 成果物 输入 兼容 上传 解析" },
  { id: "workflow-closure", label: "流程完整闭环", pattern: /流程|闭环|workflow|stage|gate|validation|release|状态|诊断|实验/i, query: "workflow stage gate runtime validation release diagnosis experiment state closed loop 流程 闭环 状态 验证 发布" },
  { id: "uiux", label: "UI/UX 与操作体验", pattern: /ui\/?ux|界面|审美|操作习惯|易用|导航|交互|产品体验/i, query: "ui ux project studio stage panels navigation interaction layout dashboard usability product experience 界面 审美 操作 导航 交互" },
  { id: "performance", label: "运行性能", pattern: /速度|性能|慢|加载|延迟|耗时|performance|latency|timeout/i, query: "performance latency timeout run manager loading parallel cache retry 性能 延迟 加载 耗时" },
  { id: "model-routing", label: "模型连接与路由", pattern: /模型|provider|供应商|连接|切换模型|ai model/i, query: "provider model routing byok connection settings ai gateway 模型 供应商 连接 路由" },
  { id: "output-quality", label: "成果质量与交付", pattern: /成果物|输出|交付|质量|完整性|materialize|artifact ready/i, query: "output artifact materialize acceptance deliverable integrity quality release 成果 输出 交付 完整 质量" },
];

function tokenize(value: string) {
  const ascii = value.toLowerCase().match(/[a-z0-9_.\/-]{2,}/g) ?? [];
  const cjk = value.match(/[\u4e00-\u9fff]{2,12}/g) ?? [];
  const cjkParts = cjk.flatMap((part) => {
    const pieces = [part];
    if (part.length > 4) for (let i = 0; i <= part.length - 2; i += 2) pieces.push(part.slice(i, Math.min(part.length, i + 4)));
    return pieces;
  });
  return [...new Set([...ascii, ...cjkParts])].slice(0, 80);
}

export function requirementAnchors(command: string) {
  const presets = GOAL_PRESETS.filter((preset) => preset.pattern.test(command)).map((preset) => ({ id: preset.id, label: preset.label, query: preset.query, tokens: tokenize(`${preset.query} ${preset.label}`) }));
  const userSegments = command.split(/[，。；;、\n]|以及|同时|并且|从|角度/g).map((item) => item.trim()).filter((item) => item.length >= 4 && item.length <= 80).slice(0, 8);
  for (const [index, segment] of userSegments.entries()) {
    if (GOAL_PRESETS.some((preset) => preset.pattern.test(segment))) continue;
    presets.push({ id: `user-${index + 1}`, label: segment.slice(0, 30), query: segment, tokens: tokenize(segment) });
  }
  return presets.length ? presets : [{ id: "user-goal", label: "用户进化目标", query: command || "整体质量 完整性 可用性", tokens: tokenize(command || "整体质量 完整性 可用性") }];
}

function entryText(entry: RepositoryEntry, analysis?: CodeAnalysis) {
  return `${entry.path}\n${analysis?.exports.join(" ") ?? ""}\n${analysis?.functions.join(" ") ?? ""}\n${analysis?.classes.join(" ") ?? ""}\n${analysis?.jsxTags.join(" ") ?? ""}\n${analysis?.routeHints.join(" ") ?? ""}\n${entry.content ?? ""}`.toLowerCase();
}

function scoreTokens(text: string, tokens: string[]) {
  let score = 0;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!lower || !text.includes(lower)) continue;
    const occurrences = text.split(lower).length - 1;
    score += 1 + Math.min(3, occurrences * 0.25);
  }
  return score;
}

export function retrieveRepositoryEvidence(args: { entries: RepositoryEntry[]; codeAnalyses: CodeAnalysis[]; intelligence: RepositoryIntelligence; query: string; limit?: number }) {
  const analysisByPath = new Map(args.codeAnalyses.map((analysis) => [analysis.path, analysis]));
  const tokens = tokenize(args.query);
  const critical = new Map(args.intelligence.criticalModules.map((item) => [item.path, item.score]));
  const scored = args.entries.map((entry) => {
    const analysis = analysisByPath.get(entry.path);
    const text = entryText(entry, analysis);
    let score = scoreTokens(text, tokens) * 4 + (critical.get(entry.path) ?? 0) * 0.35 + roleWeight(entry.role);
    if (entry.role === "test-evidence" || entry.role === "reference-evidence") score *= 0.25;
    return { entry, analysis, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const selected = new Map<string, typeof scored[number]>();
  const limit = args.limit ?? 12;
  for (const item of scored) {
    if (selected.size >= limit) break;
    selected.set(item.entry.path, item);
  }
  // Pull one-hop internal dependencies/reverse-dependencies for the strongest seed files.
  const neighborPaths = new Set<string>();
  const seedPaths = [...selected.keys()].slice(0, Math.min(6, limit));
  for (const edge of args.intelligence.dependencyEdges) {
    if (edge.kind !== "internal" || !edge.to) continue;
    if (seedPaths.includes(edge.from)) neighborPaths.add(edge.to);
    if (seedPaths.includes(edge.to)) neighborPaths.add(edge.from);
  }
  for (const path of neighborPaths) {
    if (selected.size >= limit + 6 || selected.has(path)) continue;
    const entry = args.entries.find((item) => item.path === path);
    if (!entry) continue;
    selected.set(path, { entry, analysis: analysisByPath.get(path), score: 0.5 });
  }
  return [...selected.values()].map((item) => ({ path: item.entry.path, role: item.entry.role, family: item.entry.family, content: item.entry.content, analysis: item.analysis, score: Number(item.score.toFixed(2)) }));
}

export function repositoryGoalCoverage(args: { artifact: SourceArtifact; command: string }) {
  const value = args.artifact.structuredContent as { entries?: RepositoryEntry[]; codeIndex?: { files?: CodeAnalysis[] }; repositoryIntelligence?: RepositoryIntelligence } | undefined;
  const entries = value?.entries ?? [];
  const analyses = value?.codeIndex?.files ?? [];
  const intelligence = value?.repositoryIntelligence ?? buildRepositoryIntelligence({ entries, codeAnalyses: analyses, totalEntries: args.artifact.structure.length });
  const anchors = requirementAnchors(args.command);
  const evaluated: RepositoryRequirementAnchor[] = anchors.map((anchor) => {
    const evidence = retrieveRepositoryEvidence({ entries, codeAnalyses: analyses, intelligence, query: `${anchor.query} ${args.command}`, limit: 10 });
    const strong = evidence.filter((item) => item.score >= 3 && item.role !== "test-evidence" && item.role !== "reference-evidence");
    const coverage = Math.min(1, strong.length / 3);
    return { ...anchor, evidencePaths: strong.map((item) => item.path).slice(0, 8), coverage };
  });
  const requirementEvidenceCoverage = evaluated.length ? evaluated.reduce((sum, anchor) => sum + anchor.coverage, 0) / evaluated.length : 0;
  const deepIndexCoverage = intelligence.eligibleEntries ? intelligence.deepIndexedEntries / intelligence.eligibleEntries : 0;
  const dependencyCoverage = intelligence.internalImports ? intelligence.resolvedInternalImports / intelligence.internalImports : 1;
  const criticalCount = intelligence.criticalModules.length;
  const inspectedCritical = intelligence.criticalModules.filter((module) => {
    const entry = entries.find((item) => item.path === module.path);
    const analysis = analyses.find((item) => item.path === module.path);
    return Boolean(entry?.content) && (entry?.family !== "code" || analysis?.parseOk !== false);
  }).length;
  const criticalModuleCoverage = criticalCount ? inspectedCritical / criticalCount : deepIndexCoverage;
  const semanticCoverage = Math.min(1, deepIndexCoverage * 0.25 + criticalModuleCoverage * 0.35 + dependencyCoverage * 0.15 + requirementEvidenceCoverage * 0.25);
  return { intelligence, anchors: evaluated, deepIndexCoverage, dependencyCoverage, criticalModuleCoverage, requirementEvidenceCoverage, semanticCoverage };
}

export function repositoryGoalCoverageForProject(project: Pick<EvolveProject, "sourceArtifacts" | "evolutionCommand">) {
  return project.sourceArtifacts.filter((artifact) => artifact.role === "target" && artifact.artifactKind === "codebase").map((artifact) => ({ artifact, ...repositoryGoalCoverage({ artifact, command: project.evolutionCommand }) }));
}
