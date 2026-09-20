import type { AcceptanceCriterion, ArtifactKind, SourceArtifact } from "../schemas";
import { artifactStrategyCriteria, describeArtifact, resolveArtifactStrategy } from "./artifact-strategy";

/** Backward-compatible facade. V2.4 的真实逻辑已迁移到 artifact-strategy.ts。 */
export type ArtifactCapabilityProfile = {
  kind: ArtifactKind;
  label: string;
  buildStrategy: string;
  evaluationFocus: string[];
  requiredHardGates: Array<{ title: string; requirement: string; evidence: string[]; judgeType: AcceptanceCriterion["judgeType"] }>;
};

export function artifactProfile(artifact: Pick<SourceArtifact, "artifactKind" | "artifactDescriptor" | "name" | "mimeType" | "extension" | "structure" | "structuredContent">): ArtifactCapabilityProfile {
  const full = artifact as SourceArtifact;
  const descriptor = artifact.artifactDescriptor ?? describeArtifact(artifact);
  const strategy = resolveArtifactStrategy({ ...full, artifactDescriptor: descriptor });
  const probe = strategy.criteria({ ...full, artifactDescriptor: descriptor }, 0);
  return {
    kind: artifact.artifactKind,
    label: strategy.label,
    buildStrategy: `${strategy.mutationMode} → ${strategy.outputMode}`,
    evaluationFocus: descriptor.evolutionDimensions,
    requiredHardGates: probe.filter((item) => item.hardGate).map((item) => ({ title: item.title, requirement: item.requirement, evidence: item.evidenceExpected, judgeType: item.judgeType })),
  };
}

export function artifactSpecificCriteria(artifacts: SourceArtifact[]): AcceptanceCriterion[] {
  return artifactStrategyCriteria(artifacts);
}
