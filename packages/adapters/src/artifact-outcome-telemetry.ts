import {createHash} from 'node:crypto';import {ARTIFACT_OUTCOME_METADATA_KEY,type ArtifactOutcomeStudy,type OutcomeArm,type OutcomeMetricSampleInput} from '@evolution/contracts';import {artifactStudyFingerprint,validateArtifactTaskRecords} from '@evolution/core';
/** Normalize a complete, source-bound task response. Does not attest human authenticity or actual billing. */
export function artifactTaskTelemetrySamples(study:ArtifactOutcomeStudy,arm:OutcomeArm,records:unknown[],now:number):OutcomeMetricSampleInput[]{
 const tasks=validateArtifactTaskRecords(study,arm,records,now),fingerprint=artifactStudyFingerprint(study),samples:OutcomeMetricSampleInput[]=[];
 for(const task of tasks)for(const metric of [
  {metricKey:study.acceptanceMetricKey,metricKind:'business' as const,direction:'higher' as const,unit:'ratio',value:Number(task.accepted)},
  {metricKey:study.elapsedMetricKey,metricKind:'latency' as const,direction:'lower' as const,unit:'ms',value:task.elapsedMs},
  {metricKey:study.costMetricKey,metricKind:'cost' as const,direction:'lower' as const,unit:study.costUnit,value:task.actualCost},
 ])samples.push({id:'artifact-outcome-'+createHash('sha256').update(JSON.stringify([study.id,fingerprint,study.candidateId,arm,task.taskId,metric.metricKey])).digest('hex'),candidateId:study.candidateId,arm,...metric,source:study.source,segment:study.segment,observedAt:task.observedAt,observation:{schemaVersion:'outcome-observation-v1',kind:'independent-task',taskId:task.taskId},metadata:{[ARTIFACT_OUTCOME_METADATA_KEY]:{schemaVersion:'artifact-outcome-subject-v1',studyId:study.id,studyFingerprint:fingerprint,artifacts:task.artifacts}}});
 return samples;
}
