import { deliveryReadiness } from "./delivery-readiness";
import {databaseProjects,saveDatabaseProjects,initializeProjectDatabase} from "./project-database";

import { EvolveProjectSchema, type EvolveProject, type EvaluationResult } from "../schemas";
import { materializeChampionOutputs, maybeUpdateSearchChampion } from "./evolution-search";
import { endRunTask, setAutoGateFlag } from "./run-manager";

const KEY = "evolve-studio:projects:v2.2";
const LEGACY_KEYS = ["evolve-studio:projects:v2.1", "evolve-studio:projects:v0.5", "evolve-studio:projects:v0.4", "evolve-studio:projects:v0.3", "evolve-studio:projects:v0.2"];
/** 历史迁移只做一次的标记：迁过后即使当前存储被删空，也绝不再回读旧版本键。 */
const MIGRATION_FLAG = "evolve-studio:projects:migrated:v2.2";

/**
 * 历史数据修复：早期评阅模型曾把 0-100 百分制答成 0-1 比例（0.92 即 92%）并存档，
 * 页面渲染成「准确率 1%」。读取时把 (0,1] 的百分比分数还原为百分制；
 * 真实打出 1 分的可能性可忽略，1.0 几乎必然是「满分比例」。幂等，可重复执行。
 */
function toPercentScore(value: number): number {
  return value > 0 && value <= 1 ? Math.round(value * 100) : value;
}

function repairEvaluation(evaluation: EvaluationResult | undefined) {
  if (!evaluation) return;
  evaluation.accuracy = toPercentScore(evaluation.accuracy);
  evaluation.evidence = toPercentScore(evaluation.evidence);
  evaluation.riskCoverage = toPercentScore(evaluation.riskCoverage);
  evaluation.completeness = toPercentScore(evaluation.completeness);
}

function repairProjectScores(project: EvolveProject) {
  for (const candidate of project.candidates) {
    candidate.accuracy = toPercentScore(candidate.accuracy);
    candidate.evidence = toPercentScore(candidate.evidence);
    candidate.riskCoverage = toPercentScore(candidate.riskCoverage);
  }
  for (const metric of project.metrics) {
    if (metric.unit === "%" && metric.direction === "higher") metric.value = toPercentScore(metric.value);
  }
  repairEvaluation(project.baselineRun.result);
  for (const result of project.experimentRun.candidateResults) repairEvaluation(result.evaluation);
  repairEvaluation(project.validationRun.evaluation);
  repairEvaluation(project.campaign.rootBaseline);
  repairEvaluation(project.searchChampion?.evaluation);
  repairEvaluation(project.searchChampion?.validation?.evaluation);
  for (const entry of project.evolutionArchive) repairEvaluation(entry.evaluation);
}

/**
 * 历史数据修复：早期版本曾在成果物文末附「进化对象原文」附录，成果物应只保留进化产物。
 * 读取时统一剥掉附录（幂等）；回滚曾把带附录的内容写回进化对象，源材料一并清理。
 */
function stripSourceAppendix(content: string): string {
  const at = content.lastIndexOf("## 附录 · 进化对象原文");
  if (at < 0) return content;
  return content.slice(0, at).replace(/[\s-]+$/, "");
}

function repairProjectArtifacts(project: EvolveProject) {
  // V2.1 新增 Gate F；V2.2 继续保留。历史项目在迁移时补齐，避免 Release 流程绕过最终成果验收。
  if (!project.gates.some((gate) => gate.id === "artifact-ready")) {
    const releaseIndex = project.gates.findIndex((gate) => gate.id === "release-ready");
    const artifactGate = { id: "artifact-ready" as const, status: "pending" as const, note: "V2.1 迁移：等待最终 Artifact Acceptance" };
    if (releaseIndex >= 0) project.gates.splice(releaseIndex, 0, artifactGate); else project.gates.push(artifactGate);
  }
  for (const version of project.versions) for (const artifact of version.artifacts) artifact.content = stripSourceAppendix(artifact.content);
  for (const artifact of project.sourceArtifacts) {
    if (artifact.textContent) artifact.textContent = stripSourceAppendix(artifact.textContent);
    if (artifact.textExcerpt) artifact.textExcerpt = stripSourceAppendix(artifact.textExcerpt);
  }
  const championSnapshot = project.searchChampion?.validation?.versionSnapshot;
  if (championSnapshot) for (const artifact of championSnapshot.artifacts) artifact.content = stripSourceAppendix(artifact.content);
}

/**
 * 历史数据修复：早期单轮流程通过 Gate F 后只冻结了成果物与版本，没有结算 Search Champion，
 * 导致成果中心 / 成果面板把已完成的一轮当成「还没有成果」。读取时按既有验收结论补登记
 * Champion（幂等），并补齐 manifest / scorecard 等元数据成果，让老项目也能打开完整成果包。
 */
function repairMissingChampion(project: EvolveProject) {
  if (project.searchChampion) return;
  const acceptance = project.artifactAcceptance;
  const validation = project.validationRun;
  if (acceptance.status !== "passed" || validation.recommendation !== "release" || !validation.evaluation) return;
  const winnerId = validation.candidateId ?? acceptance.candidateId ?? project.experimentRun.winnerId;
  const winner = project.candidates.find((candidate) => candidate.id === winnerId);
  if (!winner) return;
  if (!deliveryReadiness(project).ready) {
    // Preserve legacy files for inspection without inventing acceptance evidence.
    project.outputArtifacts = project.outputArtifacts.map((artifact) => artifact.candidateId === winner.id ? { ...artifact, accepted: false } : artifact);
    return;
  }
  const update = maybeUpdateSearchChampion({
    project,
    current: undefined,
    round: project.roundHistory.length + 1,
    winner,
    validation,
    artifactAcceptance: acceptance,
    baseline: project.campaign.rootBaseline ?? project.baselineRun.result,
    parentVersionId: project.version,
    minImprovement: project.campaign.stopCriteria.minImprovement,
  });
  if (!update.champion) return;
  project.searchChampion = update.champion;
  if (!project.outputArtifacts.some((artifact) => artifact.kind === "manifest")) {
    project.outputArtifacts = [...project.outputArtifacts, ...materializeChampionOutputs(project).filter((artifact) => artifact.kind !== "primary")];
  }
}

function parseProjects(raw: string | null): EvolveProject[] {
  if (!raw) return [];
  try {
    const parsed = EvolveProjectSchema.array().parse(JSON.parse(raw));
    for (const project of parsed) { repairProjectScores(project); repairProjectArtifacts(project); repairMissingChampion(project); }
    return parsed;
  } catch { return []; }
}

function readStorageItem(key: string): string | null | undefined {
  try { return window.localStorage.getItem(key); }
  catch { return undefined; }
}

function readAll(): EvolveProject[] {
  if (databaseProjects()) return databaseProjects()!;
  if (typeof window === "undefined") return [];
  // 当前键只要存在（包括「把项目删光后写回的 []」）就是唯一权威数据源；
  // 旧版本键里还躺着用户早已删除的项目副本，一旦回落去读，就会把删除记录整体复活。
  // 因此只在当前键从未被创建过、且历史迁移尚未执行时，才做一次性升级迁移。
  const raw = readStorageItem(KEY);
  if (raw === undefined) return [];
  if (raw !== null) return parseProjects(raw);
  const migrationFlag = readStorageItem(MIGRATION_FLAG);
  if (migrationFlag === undefined || migrationFlag === "1") return [];
  for (const legacyKey of LEGACY_KEYS) {
    const legacy = readStorageItem(legacyKey);
    if (legacy === undefined) return [];
    const migrated = parseProjects(legacy);
    if (migrated.length) {
      window.localStorage.setItem(KEY, JSON.stringify(migrated));
      window.localStorage.setItem(MIGRATION_FLAG, "1");
      return migrated;
    }
  }
  window.localStorage.setItem(MIGRATION_FLAG, "1");
  return [];
}

export function listLocalProjects() { return readAll(); }
export function getLocalProject(id: string) { return readAll().find((project) => project.id === id); }

export function saveLocalProject(project: EvolveProject) {
  if (typeof window === "undefined") return;
  const projects = readAll();
  const next = [project, ...projects.filter((item) => item.id !== project.id)];
  if(databaseProjects()) saveDatabaseProjects(next); else window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("evolve-projects-changed"));
}

export function deleteLocalProject(id: string) {
  if (typeof window === "undefined") return;
  const next = readAll().filter((item) => item.id !== id);
  if(databaseProjects()) saveDatabaseProjects(next); else window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("evolve-projects-changed"));
  // 项目删除后清掉它的运行登记与自动运行开关，避免残留记录触发无主续跑。
  endRunTask(id);
  setAutoGateFlag(id, false);
}

/** 示例项目删除标记：删掉后所有入口（项目列表 / 仪表盘 / 全局搜索）都不得再把它补回来。 */
const DEMO_REMOVED_KEY = "evolve-studio:demo-removed:v1";
export function isDemoRemoved(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(DEMO_REMOVED_KEY) === "1"; } catch { return false; }
}
export function markDemoRemoved() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DEMO_REMOVED_KEY, "1"); } catch { /* 本地存储不可用时静默降级 */ }
}

export async function initializeLocalProjects(){
  await initializeProjectDatabase(readAll());
  if(databaseProjects()){
    // IndexedDB is now authoritative. Denied legacy storage must not hide it.
    try{window.localStorage.removeItem(KEY);}catch{/* IndexedDB remains authoritative. */}
    return;
  }
  if(typeof window==="undefined")return;
  // No durable browser store is usable; mounting a writable-looking UI would lose projects.
  if(readStorageItem(KEY)===undefined)throw new Error("浏览器项目存储不可用，请允许本地存储后重试。未覆盖原有数据。");
}
