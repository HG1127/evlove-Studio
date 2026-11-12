export interface ArtifactRepairMemoryEntry {
  round: number;
  kind: string;
  score: number;
  safety: string;
  failures: string[];
  patches: Array<{ component: string; operation: string; target: string }>;
  repairReflection?: { parentCandidateId:string; rootCause:string; failureCaseIds:string[]; mutationRationale:string; antiPatternsAvoided:string[] };
}
export interface ArtifactRepairMemory {
  recent: Array<{ round: number; kind: string; score: number; safety: string; failureCount: number; patchFamilies: string[] }>;
  antiPatterns: Array<{ family: string; attempts: number; failures: number; bestScore: number }>;
  reflections: Array<{ parentCandidateId:string; rootCause:string; failureCaseIds:string[]; mutationRationale:string; antiPatternsAvoided:string[] }>;
  source: "non-sensitive archive aggregates only";
  privacy: string;
}
export function buildArtifactRepairMemory(entries: ArtifactRepairMemoryEntry[], limit = 8): ArtifactRepairMemory {
  const familyStats = new Map<string, { attempts: number; wins: number; failures: number; bestScore: number }>();
  const recent = entries.slice(-Math.max(0, Math.min(limit, 20))).map((entry) => {
    const families = [...new Set(entry.patches.map((patch) =>
      patch.component.toLowerCase().trim() + ":" + patch.operation.toLowerCase().trim() + ":" +
      (patch.target.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 48) || "*"),
    ))];
    for (const family of families) {
      const current = familyStats.get(family) ?? { attempts: 0, wins: 0, failures: 0, bestScore: -Infinity };
      current.attempts += 1;
      current.wins += entry.kind === "champion" ? 1 : 0;
      current.failures += entry.kind === "failure" || entry.safety === "FAIL" ? 1 : 0;
      current.bestScore = Math.max(current.bestScore, entry.score);
      familyStats.set(family, current);
    }
    return { round: entry.round, kind: entry.kind, score: entry.score, safety: entry.safety,
      failureCount: entry.failures.length, patchFamilies: families.slice(0, 6) };
  });
  const antiPatterns = [...familyStats.entries()]
    .filter(([, stats]) => stats.attempts >= 2 && stats.wins === 0 && stats.failures > 0)
    .sort((a, b) => b[1].failures - a[1].failures || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([family, stats]) => ({ family, attempts: stats.attempts, failures: stats.failures,
      bestScore: Number.isFinite(stats.bestScore) ? stats.bestScore : 0 }));
  const reflections=entries.slice(-Math.max(0,Math.min(limit,20))).flatMap(entry=>entry.repairReflection?[{...entry.repairReflection}]:[]);
  return { recent, antiPatterns, reflections, source: "non-sensitive archive aggregates only",
    privacy: "No hidden holdout prompts, answers, raw test inputs, or private final-paper contents are included." };
}