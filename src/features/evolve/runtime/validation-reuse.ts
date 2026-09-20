import type { TestCase, TargetRunResult, EvolveProject, Candidate } from "../schemas";

export function validationImpactPriority(project: EvolveProject, candidate: Candidate) {
  const changed = new Set(candidate.patches.map(patch => patch.target).filter(Boolean));
  const neighbors = new Set<string>();
  for (const source of project.sourceArtifacts) {
    const edges = (source.structuredContent as { repositoryIntelligence?: { dependencyEdges?: Array<{from:string;to?:string;kind:string}> } } | undefined)?.repositoryIntelligence?.dependencyEdges ?? [];
    for (const edge of edges) {
      if (edge.kind !== "internal" || !edge.to) continue;
      if (changed.has(edge.from)) neighbors.add(edge.to);
      if (changed.has(edge.to)) neighbors.add(edge.from);
    }
  }
  return (test: TestCase) => {
    const evidence = JSON.stringify([test.title, test.input, test.expected]);
    if ([...changed].some(path => evidence.includes(path))) return 20;
    if ([...neighbors].some(path => evidence.includes(path))) return 10;
    return 0;
  };
}

/**
 * Exact-evidence reuse. A scoped cache survives sequential validation calls in the same browser
 * session, so Fast Gate → full holdout and "revalidate the same Candidate" do not repay for the
 * same local proof. The caller must put the real artifact/contract fingerprint in `variant`.
 * External/visual/manual evidence is never cached here.
 */
const SESSION_EVIDENCE_CACHE = new Map<string, { at: number; run: TargetRunResult }>();
const SESSION_EVIDENCE_TTL_MS = 30 * 60_000;
const SESSION_EVIDENCE_CAP = 256;

function sessionGet(key: string) {
  const hit = SESSION_EVIDENCE_CACHE.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > SESSION_EVIDENCE_TTL_MS) { SESSION_EVIDENCE_CACHE.delete(key); return undefined; }
  return structuredClone(hit.run);
}
function sessionSet(key: string, run: TargetRunResult) {
  SESSION_EVIDENCE_CACHE.set(key, { at: Date.now(), run: structuredClone(run) });
  while (SESSION_EVIDENCE_CACHE.size > SESSION_EVIDENCE_CAP) {
    const oldest = SESSION_EVIDENCE_CACHE.keys().next();
    if (oldest.done) break;
    SESSION_EVIDENCE_CACHE.delete(oldest.value);
  }
}
export function clearValidationReuseCache() { SESSION_EVIDENCE_CACHE.clear(); }

export function createValidationReuse(scope?: string) {
  const cache = new Map<string, TargetRunResult>();
  const key = (variant: string, test: TestCase) => JSON.stringify([scope ?? "local", variant, test]);
  const eligible = (test: TestCase) => ["artifact-runtime", "static-evidence", "roundtrip"].includes(test.executionMode);
  const read = (variant: string, test: TestCase) => {
    const k = key(variant, test);
    return cache.get(k) ?? (scope ? sessionGet(k) : undefined);
  };
  return async (variant: string, cases: TestCase[], execute: (missing: TestCase[], progress: (done: number) => void) => Promise<TargetRunResult[]>, onProgress?: (done: number, total: number) => void) => {
    const missing = cases.filter(test => !eligible(test) || !read(variant, test));
    const reused = cases.length - missing.length;
    onProgress?.(reused, cases.length);
    const runs = missing.length ? await execute(missing, done => onProgress?.(reused + done, cases.length)) : [];
    const fresh = new Map(runs.map(run => [run.testCaseId, run]));
    for (const test of missing) {
      const run = fresh.get(test.id);
      // Scoped callers bind `variant` to exact source/candidate + contract/model fingerprints.
      // Unscoped legacy callers still require a runtime-provided artifactHash before reuse.
      if (eligible(test) && run && !run.error && run.verificationStatus === "verified" && (Boolean(run.artifactHash) || Boolean(scope))) {
        const k = key(variant, test);
        cache.set(k, structuredClone(run));
        if (scope) sessionSet(k, run);
      }
    }
    return cases.map(test => fresh.get(test.id) ?? read(variant, test) ?? { testCaseId: test.id, output: "执行未返回结果", latencyMs: 0, cost: 0, trace: [], error: "missing result", verificationStatus: "failed" as const });
  };
}
