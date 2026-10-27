import {LessonProvenanceSchema,type EvolveProject,type Lesson,type LessonProvenance} from "@evolution/contracts";
import {PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS} from "./release-outcome";
import {projectHasOnlineReleaseTarget} from "./release-target";

function lessonSource(project:EvolveProject){
  const acceptedId=!projectHasOnlineReleaseTarget(project)&&project.artifactAcceptance?.status==="passed"
    ?project.artifactAcceptance.candidateId:undefined;
  const candidateId=acceptedId??project.release.candidateId??project.searchChampion?.candidate?.id??project.experimentRun.winnerId;
  const champion=project.searchChampion?.candidate?.id===candidateId?project.searchChampion:undefined;
  const candidates=project.candidates.filter(candidate=>candidate.id===candidateId);
  const projections=[...candidates,...(champion?.candidate?[champion.candidate]:[])];
  const candidate=projections.find(item=>item.artifactSnapshots?.length)??projections[0];
  // A later search round can replace validationRun while the deployed Champion stays current.
  const validation=champion?.validation??project.validationRun;
  return {candidateId,candidate,projections,validation,duplicateCandidates:candidates.length>1};
}

/** Share the same actual source between distillation input and its recorded provenance. */
export function lessonDistillationSource(project:EvolveProject){
  const source=lessonSource(project);
  if(!source.candidate||source.duplicateCandidates||source.validation?.candidateId!==source.candidate.id)return undefined;
  return {candidate:source.candidate,validation:source.validation};
}

export function buildLessonProvenance(project:EvolveProject,at:string,supersedesLessonIds:string[]=[]):LessonProvenance{
  const source=lessonSource(project),snapshots=source.candidate?.artifactSnapshots??[];
  return {
    missionId:project.id,candidateId:source.candidateId,deploymentId:project.release.deploymentId,
    validationRunId:source.validation?.id,
    artifactSnapshotIds:snapshots.map(snapshot=>snapshot.id),
    artifactHashes:snapshots.flatMap(snapshot=>snapshot.contentHash?[snapshot.contentHash]:[]),
    releaseEvidenceMode:project.release.evidenceMode,releaseObservedAt:project.release.observedAt,
    derivedAt:at,supersedesLessonIds,
  };
}

/** Identity qualification only: a consistent source is not proof of causal transfer. */
export function productionLessonProvenanceBlocker(project:EvolveProject,lesson:Lesson,now:number):string|undefined{
  const parsed=LessonProvenanceSchema.safeParse(lesson.provenance);
  if(!parsed.success)return "Verified Skill 缺少有效 Provenance，不能确认经验来源。";
  const provenance=parsed.data,source=lessonSource(project);
  if(provenance.missionId!==project.id||!source.candidateId||provenance.candidateId!==source.candidateId
    ||!project.release.deploymentId||provenance.deploymentId!==project.release.deploymentId){
    return "Verified Skill Provenance 与当前 Mission / Candidate / Deployment 不一致。";
  }
  if(lesson.governance&&(lesson.governance.candidateId!==source.candidateId||lesson.governance.deploymentId!==project.release.deploymentId)){
    return "Verified Skill governance 缺少 exact Candidate / Deployment 来源绑定。";
  }
  if(!source.validation?.id||provenance.validationRunId!==source.validation.id
    ||source.validation.candidateId!==source.candidateId){
    return "Verified Skill Provenance 与源 Candidate 的 Validation 不一致。";
  }
  const snapshots=source.candidate?.artifactSnapshots??[];
  if(source.duplicateCandidates||!snapshots.length||snapshots.some(snapshot=>!snapshot.id||!snapshot.sourceArtifactId||!snapshot.contentHash)
    ||new Set(snapshots.map(snapshot=>snapshot.id)).size!==snapshots.length
    ||new Set(snapshots.map(snapshot=>snapshot.sourceArtifactId)).size!==snapshots.length){
    return "Verified Skill 缺少唯一、完整的 Candidate Artifact 来源。";
  }
  const ids=provenance.artifactSnapshotIds,hashes=provenance.artifactHashes;
  if(ids.length!==snapshots.length||hashes.length!==snapshots.length||new Set(ids).size!==ids.length
    ||!snapshots.every(snapshot=>hashes[ids.indexOf(snapshot.id)]===snapshot.contentHash)){
    return "Verified Skill Provenance 的 Artifact Snapshot / Hash 配对不一致。";
  }
  if(source.projections.some(candidate=>candidate.artifactSnapshots?.length&&(
    candidate.artifactSnapshots.length!==snapshots.length
    ||new Set(candidate.artifactSnapshots.map(snapshot=>snapshot.id)).size!==snapshots.length
    ||!candidate.artifactSnapshots.every(snapshot=>snapshots.some(expected=>expected.id===snapshot.id
      &&expected.sourceArtifactId===snapshot.sourceArtifactId&&expected.contentHash===snapshot.contentHash))
  )))return "Verified Skill 的 Candidate 与 Champion Artifact 来源相互矛盾。";
  const released=project.release.artifactHashes;
  if(released&&(released.length!==snapshots.length||new Set(released.map(item=>item.sourceArtifactId)).size!==released.length
    ||!snapshots.every(snapshot=>released.some(item=>item.sourceArtifactId===snapshot.sourceArtifactId&&item.contentHash===snapshot.contentHash)))){
    return "Verified Skill 的源 Artifact 与实际 Release Hash 不一致。";
  }
  if(!released&&project.release.artifactHash&&(snapshots.length!==1||project.release.artifactHash!==snapshots[0]!.contentHash)){
    return "Verified Skill 的源 Artifact 与实际 Release Hash 不一致。";
  }
  const observed=Date.parse(provenance.releaseObservedAt??""),derived=Date.parse(provenance.derivedAt);
  if(provenance.releaseEvidenceMode!=="live"||!Number.isFinite(now)||!Number.isFinite(observed)||!Number.isFinite(derived)
    ||observed>derived+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS||derived>now+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS){
    return "Verified Skill Provenance 缺少有效 live 观测或来源时间顺序。";
  }
  return undefined;
}
