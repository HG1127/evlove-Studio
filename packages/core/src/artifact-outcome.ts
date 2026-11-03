import {ArtifactOutcomeStudySchema,ArtifactOutcomeSubjectSchema,ArtifactOutcomeAssessmentSchema,ArtifactTaskRecordSchema,ARTIFACT_OUTCOME_METADATA_KEY,type ArtifactOutcomeStudy,type ArtifactTaskRecord,type EvolveProject,type OutcomeMetricSample,type OutcomeArm} from '@evolution/contracts';
import {assertDeliverablePackageIdentity} from './artifact-output';import {fastHash} from './stable-hash';import {assessTaskBenefitCohorts} from './business-benefit-cohorts';import {PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS} from './release-outcome';
const canonical=(refs:ArtifactOutcomeStudy['originalArtifacts'])=>JSON.stringify(refs.slice().sort((a,b)=>a.sourceArtifactId.localeCompare(b.sourceArtifactId)));
export const artifactStudyFingerprint=(study:ArtifactOutcomeStudy)=>fastHash(JSON.stringify(ArtifactOutcomeStudySchema.parse(study)));
export function assertArtifactOutcomeStudyBinding(project:EvolveProject,raw:ArtifactOutcomeStudy,now:number){
 const study=ArtifactOutcomeStudySchema.parse(raw),id=assertDeliverablePackageIdentity(project),champion=project.searchChampion?.candidate?.id===id?project.searchChampion:undefined;
 const acceptance=champion?.artifactAcceptance??project.artifactAcceptance;
 if(study.missionId!==project.id||study.candidateId!==id||study.acceptanceId!==acceptance.id||study.evidenceFingerprint!==acceptance.evidenceFingerprint)throw Error('Artifact study does not match the accepted package identity');
 const originals=project.baselineRun.originalReferences??[],primary=project.outputArtifacts.filter(a=>a.kind==='primary'),registered=Date.parse(study.registeredAt);
 if(!Number.isFinite(now)||registered>now)throw Error('Artifact study is not registered yet');
 const originalRefs=primary.map(a=>{const r=originals.find(r=>r.sourceArtifactId===a.sourceArtifactIds[0]);if(!r||r.missionId!==project.id)throw Error('Original artifact custody is missing');return {sourceArtifactId:r.sourceArtifactId,blobId:r.blobId,sha256:r.sha256,sizeBytes:r.sizeBytes};});
 const candidateRefs=primary.map(a=>{const f=a.frozenArtifact;if(!f||a.renderedArtifactRef!==f.blobId||a.renderedSha256!==f.sha256||a.renderedSize!==f.size||!a.renderedAt||!Number.isFinite(Date.parse(a.renderedAt))||Date.parse(a.renderedAt)>registered)throw Error('Artifact study requires previously rendered exact accepted bytes');return {sourceArtifactId:f.sourceArtifactId,blobId:f.blobId,sha256:f.sha256,sizeBytes:f.size};});
 if(canonical(originalRefs)!==canonical(study.originalArtifacts)||canonical(candidateRefs)!==canonical(study.candidateArtifacts))throw Error('Artifact study original or Candidate references differ');
 return study;
}
export function validateArtifactTaskRecords(study:ArtifactOutcomeStudy,arm:OutcomeArm,raw:unknown[],now:number):ArtifactTaskRecord[]{
 const expected=arm==='stable'?study.originalArtifacts:study.candidateArtifacts,ids=new Set(arm==='stable'?study.stableTaskIds:study.candidateTaskIds),unique=new Map<string,ArtifactTaskRecord>();
 if(raw.length>500)throw Error('Artifact task record batch exceeds the complete collection boundary');
 for(const value of raw){const row=ArtifactTaskRecordSchema.parse(value),at=Date.parse(row.observedAt);row.observedAt=new Date(at).toISOString();
  if(!ids.has(row.taskId)||row.currency!==study.costUnit||canonical(row.artifacts)!==canonical(expected))throw Error('Task identity, currency or consumed artifact bytes differ from the frozen study');
  if(!Number.isFinite(now)||at<Date.parse(study.registeredAt)||at>now+PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS)throw Error('Task time is outside the registered study');
  const previous=unique.get(row.taskId);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw Error('Artifact task replay conflicts with prior content');unique.set(row.taskId,row);
 }return [...unique.values()];
}
export function assessArtifactTaskBenefit(input:{study:ArtifactOutcomeStudy;samples:OutcomeMetricSample[];checkedAt:string;artifactCustodyVerified:boolean;configurationError?:string}){
 const study=ArtifactOutcomeStudySchema.parse(input.study),fingerprint=artifactStudyFingerprint(study);
 const assessment=assessTaskBenefitCohorts({policy:study,samples:input.samples,checkedAt:input.checkedAt,configurationError:input.configurationError??(!input.artifactCustodyVerified?'Accepted and original artifact custody has not been verified':undefined),scopeMatches:rows=>{
  if(!rows.length||new Set(rows.map(r=>r.workspaceId)).size!==1)return false;
  return rows.every(r=>{if(r.missionId!==study.missionId||r.candidateId!==study.candidateId||r.deploymentId!==undefined||Date.parse(r.observedAt)<Date.parse(study.registeredAt))return false;
   const parsed=ArtifactOutcomeSubjectSchema.safeParse(r.metadata[ARTIFACT_OUTCOME_METADATA_KEY]);if(!parsed.success)return false;const s=parsed.data;
   return s.studyId===study.id&&s.studyFingerprint===fingerprint&&canonical(s.artifacts)===canonical(r.arm==='stable'?study.originalArtifacts:study.candidateArtifacts);
  });
 }});
 return ArtifactOutcomeAssessmentSchema.parse({...assessment,schemaVersion:'artifact-task-benefit-v1',studyId:study.id,missionId:study.missionId,candidateId:study.candidateId,studyFingerprint:fingerprint,artifactCustodyVerified:input.artifactCustodyVerified,establishesRealUserBenefit:false});
}
