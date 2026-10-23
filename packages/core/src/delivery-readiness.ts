import { evidenceFingerprint } from "./evidence-binding";
import { hasExactFrozenArtifactSet } from "./artifact-identity";
import { hasAuthoritativeHiddenRelease } from "./hidden-validation-evidence";
import {independentFinalReadiness} from "./independent-final-holdout";
import type { EvolveProject } from "@evolution/contracts";

/** One decision for user navigation and release approval. Running a test is not passing it. */
export function deliveryReadiness(project: EvolveProject) {
  const reasons: string[] = [];
  const winnerId = project.experimentRun.winnerId;
  if (!hasAuthoritativeHiddenRelease(project.validationRun, winnerId ?? "", project.hiddenEvalSuite, project.acceptanceRubric)) reasons.push("独立 Hidden Validation 缺少完整非演示评测或未通过");
  if (project.artifactAcceptance.status !== "passed" || !project.artifactAcceptance.hardGatePass) reasons.push("成果完整性或必要要求尚未通过");
  if (!winnerId || project.artifactAcceptance.candidateId !== winnerId || project.validationRun.candidateId !== winnerId) reasons.push("验收结果与当前候选版本不一致");
  const candidate = project.candidates.find((item) => item.id === winnerId);
  if(candidate&&!independentFinalReadiness(project,candidate).ready)reasons.push("独立终验尚未通过；修复同卷不能作为最终盲测证据");
  if (!candidate?.artifactSnapshots.length) reasons.push("当前候选缺少实际成果文件");
  else if (!hasExactFrozenArtifactSet(project, candidate, project.artifactAcceptance)) reasons.push("验收冻结凭证与当前目标成果不一一对应；请重新验收");
  else {
    const binding = evidenceFingerprint(project, candidate);
    if (project.validationRun.evidenceFingerprint !== binding || project.artifactAcceptance.evidenceFingerprint !== binding) reasons.push("文件或验收条件已变化，或旧记录未绑定文件；请对当前成果重新验收");
  }
  return { ready: reasons.length === 0, reasons };
}
