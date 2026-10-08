import {
  AcceptedCandidatePackageManifestSchema, AcceptedChampionPackageManifestSchema,
  ArtifactAcceptanceSchema, CandidatePatchSchema, CandidateSchema, EvaluationResultSchema,
  PackageValidationEvidenceSchema,
  type ArtifactAcceptance, type Candidate, type EvolveProject, type OutputArtifact,
  type SearchChampion, type ValidationRun,
} from "@evolution/contracts";

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };
function decode<T>(content: string, schema: Schema<T>, label: string): T {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error(label + "不是有效 JSON；请重新生成成果包"); }
  return validate(value, schema, label);
}
function validate<T>(value: unknown, schema: Schema<T>, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(label + "缺少完整证据格式；请重新生成成果包");
  return result.data;
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, ordered(record[key])]));
}
/** Exact JSON-wire comparison; whitespace/key order and omitted undefined fields do not change evidence. */
function same(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown) => JSON.stringify(ordered(JSON.parse(JSON.stringify(value))));
  return canonical(left) === canonical(right);
}
function requireSame(left: unknown, right: unknown, label: string) {
  if (!same(left, right)) throw new Error(label + "与当前验收证据不一致；请重新生成成果包");
}
function only(artifacts: OutputArtifact[], kind: OutputArtifact["kind"], label: string): OutputArtifact {
  const matches = artifacts.filter((item) => item.kind === kind);
  if (matches.length !== 1) throw new Error(label + "必须存在且唯一；请重新生成成果包");
  return matches[0]!;
}

/** Shared deterministic content, independent of package creation and validation. */
export function requirementCoverageContent(project: EvolveProject, acceptance: ArtifactAcceptance): string {
  return "# Requirement Coverage\n\n" + project.acceptanceRubric.map((criterion) => {
    const result = acceptance.results.find((item) => item.criterionId === criterion.id);
    return "- " + (result?.pass ? "✅" : "❌") + " **" + criterion.id + " · " + criterion.title + "** — " + (result?.score ?? 0) + "/100" + (criterion.hardGate ? " · HARD GATE" : "")
      + "\n  - Requirement: " + criterion.requirement
      + "\n  - Evidence: " + ((result?.evidence ?? []).join("；") || "无")
      + "\n  - Gaps: " + ((result?.gaps ?? []).join("；") || "无");
  }).join("\n");
}

/** Bind downloaded evidence contents to the same observations as the primary files. */
export function assertPackageEvidenceContents(args: {
  project: EvolveProject; artifacts: OutputArtifact[]; candidate: Candidate;
  champion?: SearchChampion; acceptance: ArtifactAcceptance; validation: ValidationRun;
}): void {
  const { project, artifacts, candidate, champion, acceptance, validation } = args;
  const manifest = only(artifacts, "manifest", "成果包清单");
  const expectedAcceptance = validate(acceptance, ArtifactAcceptanceSchema, "当前 Gate F");
  if (champion) {
    const parsed = decode(manifest.content, AcceptedChampionPackageManifestSchema, "Champion 清单");
    requireSame(parsed.projectId, project.id, "清单 Mission");
    requireSame(parsed.searchChampion.id, champion.id, "清单 Champion");
    const expectedCandidate = validate(candidate, CandidateSchema.pick({ id: true, artifactSnapshots: true }), "当前 Candidate");
    requireSame(parsed.searchChampion.candidate, expectedCandidate, "清单 Candidate 冻结记录");
    requireSame(parsed.searchChampion.validation, validate(validation, PackageValidationEvidenceSchema, "当前 Hidden"), "清单 Hidden 作答与评审");
    requireSame(parsed.searchChampion.artifactAcceptance, expectedAcceptance, "清单 Gate F");
  } else {
    const parsed = decode(manifest.content, AcceptedCandidatePackageManifestSchema, "Candidate 清单");
    requireSame(parsed.projectId, project.id, "清单 Mission");
    requireSame(parsed.candidateId, candidate.id, "清单 Candidate");
    requireSame(parsed.validationId, validation.id, "清单 Hidden ID");
    requireSame(parsed.acceptanceId, acceptance.id, "清单 Gate F ID");
    requireSame(parsed.evidenceFingerprint, validation.evidenceFingerprint, "清单验证指纹");
    requireSame(parsed.frozenArtifacts, expectedAcceptance.frozenArtifacts, "清单冻结凭证");
  }
  const report = decode(only(artifacts, "acceptance-report", "验收报告").content, ArtifactAcceptanceSchema, "验收报告");
  requireSame(report, expectedAcceptance, "Gate F 验收报告");
  requireSame(only(artifacts, "requirement-matrix", "要求覆盖矩阵").content, requirementCoverageContent(project, acceptance), "要求覆盖矩阵");
  const scorecardSchema = EvaluationResultSchema.nullable();
  const score = decode(only(artifacts, "scorecard", "评分表").content, scorecardSchema, "评分表");
  requireSame(score, validate(champion ? champion.evaluation ?? null : validation.evaluation ?? null, scorecardSchema, "当前评分"), "评分表");
  const patchSchema = CandidatePatchSchema.array();
  const patches = decode(only(artifacts, "patch-bundle", "修改记录").content, patchSchema, "修改记录");
  requireSame(patches, validate(champion ? champion.patches : candidate.patches, patchSchema, "当前修改"), "修改记录");
}
