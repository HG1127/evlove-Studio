import type { Candidate, EvolveProject, FrozenArtifact, TargetRunResult, ValidationRun } from "@evolution/contracts";

/** Enumerate persisted byte references, never infer bytes from parsed text or patch prose. */
export function missionBlobReferences(project: EvolveProject): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => { if (id) ids.add(id); };
  const frozen = (receipt: FrozenArtifact | undefined) => add(receipt?.blobId);
  const candidate = (value: Candidate | undefined) => value?.artifactSnapshots.forEach(snapshot => frozen(snapshot.frozenArtifact));
  const runs = (values: TargetRunResult[]) => values.forEach(run => run.visualEvidenceRefs?.forEach(ref => add(ref.blobId)));
  const validation = (value: ValidationRun | undefined) => {
    value?.versionSnapshot?.artifacts.forEach(artifact => frozen(artifact.frozenArtifact));
    runs(value?.runs ?? []);
    runs(value?.baselineRuns ?? []);
  };
  project.sourceArtifacts.forEach(source => add(source.storageRef || source.id));
  project.candidates.forEach(candidate);
  project.evolutionArchive.forEach(entry => candidate(entry.candidate));
  candidate(project.searchChampion?.candidate);
  project.artifactAcceptance.frozenArtifacts?.forEach(frozen);
  project.searchChampion?.artifactAcceptance?.frozenArtifacts?.forEach(frozen);
  project.versions.forEach(version => version.artifacts.forEach(artifact => frozen(artifact.frozenArtifact)));
  validation(project.validationRun);
  validation(project.searchChampion?.validation);
  runs(project.baselineRun.runs);
  runs(project.experimentRun.comparisonBaseline?.runs ?? []);
  project.experimentRun.candidateResults.forEach(result => {
    result.artifactSnapshots.forEach(snapshot => frozen(snapshot.frozenArtifact));
    runs(result.runs);
  });
  [...project.outputArtifacts, ...(project.archivedOutputs ?? [])].forEach(output => {
    frozen(output.frozenArtifact);
    add(output.renderedArtifactRef);
  });
  return [...ids];
}
