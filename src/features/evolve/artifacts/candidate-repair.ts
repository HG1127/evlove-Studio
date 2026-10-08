import { fastHash } from "@evolution/core";
import { RepairArtifactAiResultSchema } from "../ai/schemas";
import { runEvolveAi } from "../ai/service";
import type { AcceptanceCriterion, ArtifactAcceptance, Candidate, EvolveProject } from "../schemas";
import { normalizeCandidateArtifactOutputs } from "../runtime/candidate-builder";
import { retrieveTextContext } from "../runtime/context-retrieval";
import { htmlCandidateGuard } from "../runtime/html-candidate-guard";

const supportsLocalEdits = (extension: string) => /^(html?|xhtml|md|markdown|txt|css|js|ts|tsx|jsx|json|yaml|yml|svg)$/i.test(extension);

/** Repair the current snapshot; reconstruct deltas locally before issuing a new evidence identity. */
export async function repairCandidateArtifacts(project: EvolveProject, candidate: Candidate, acceptance: ArtifactAcceptance, criteria: AcceptanceCriterion[]): Promise<Candidate> {
  const failed = criteria.flatMap((criterion) => {
    const result = acceptance.results.find((item) => item.criterionId === criterion.id);
    return result?.pass ? [] : [{ criterionId: criterion.id, requirement: criterion.requirement, minScore: criterion.minScore, hardGate: criterion.hardGate, evidenceExpected: criterion.evidenceExpected, score: result?.score ?? 0, evidence: result?.evidence ?? [], gaps: result?.gaps ?? ["该验收项未通过"] }];
  });
  if (!failed.length) return candidate;
  const originals = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  const targets = originals.map((source) => {
    const snapshot = candidate.artifactSnapshots.find((item) => item.sourceArtifactId === source.id);
    if (!snapshot) throw new Error(`当前候选缺少 ${source.name} 的完整快照，不能自动修复。`);
    return { ...source, textContent: snapshot.content, textExcerpt: snapshot.content };
  });
  const query = failed.map((item) => `${item.requirement} ${item.evidence.join(" ")} ${item.gaps.join(" ")}`).join(" ");
  const repaired = RepairArtifactAiResultSchema.parse(await runEvolveAi("repair-artifact", {
    project: {
      name: project.name, aiProfile: project.aiProfile, goal: project.goal,
      evolutionCommand: project.evolutionCommand, protectedItems: project.protectedItems, editableItems: project.editableItems,
      semanticObject: project.semanticEvolution?.semanticObject,
    },
    candidate: { id: candidate.id, title: candidate.title },
    failedCriteria: failed,
    outputInstruction: "Repair only failed criteria on the supplied CURRENT Candidate. Use only target IDs or anchors actually present in the supplied current evidence. For HTML use content JSON {kind:'html-edits',edits:[{targetId,operation:'prepend'|'append'|'replace',content}]}; prepend/append contain only new children, replace retains the unique target ID. For other editable text prefer {kind:'text-edits',edits:[{before,after}]}, where before is a unique verbatim anchor from the current content/context, without excerpt markers. The program applies edits to the full current snapshot and preserves all untouched bytes. Never regenerate a whole long file from excerpts. Return only changed artifacts with their exact sourceArtifactId; omitted files are retained from the current Candidate. Native/structured formats require their complete current format blueprint, not text edits. Return concise notes and no duplicate original content.",
    artifacts: targets.map((artifact) => {
      const text = artifact.textContent;
      const bounded = supportsLocalEdits(artifact.extension) && text.length > 32_000;
      return { sourceArtifactId: artifact.id, name: artifact.name, mimeType: artifact.mimeType, artifactDescriptor: artifact.artifactDescriptor,
        contentHash: candidate.artifactSnapshots.find((item) => item.sourceArtifactId === artifact.id)?.contentHash,
        length: text.length, content: bounded ? undefined : text,
        context: bounded ? retrieveTextContext(text, query, { maxChars: 18_000, maxChunks: 8 }) : undefined };
    }),
  }));
  // Reject unknown IDs before the compatibility normalizer can guess by filename or position.
  if (repaired.artifacts.some((artifact) => !targets.some((target) => target.id === artifact.sourceArtifactId))) throw new Error("修复结果引用了未知进化对象，当前成果已保留。");
  const outputs = normalizeCandidateArtifactOutputs(targets, repaired.artifacts.map((artifact) => ({ ...artifact, buildMode: "ai-full" as const })));
  if (outputs.every((artifact) => artifact.content === targets.find((target) => target.id === artifact.sourceArtifactId)?.textContent)) throw new Error("自动修复未产生实际修改，当前成果已保留。");
  const createdAt = new Date().toISOString();
  const snapshots = outputs.map((artifact, index) => ({
    ...artifact, id: `candidate-repair-${candidate.id}-${index}-${Date.now()}`, createdAt,
    // A repaired snapshot has no frozen receipt; validation must freeze and test its new bytes.
    contentHash: fastHash(artifact.content),
  }));
  const issues = htmlCandidateGuard(project, snapshots).flatMap((report) => report.issues);
  if (issues.length) throw new Error(`HTML 修复完整性检查失败：${issues.join("；")}`);
  return { ...candidate, name: `${candidate.name} · Repair ${acceptance.attempts + 1}`,
    title: `${candidate.title || candidate.name} · Acceptance Repair`, artifactSnapshots: snapshots,
    artifactBuildStatus: "ready", artifactBuildSummary: repaired.summary,
    notes: [...candidate.notes, `Artifact Repair：${repaired.summary}`] };
}
