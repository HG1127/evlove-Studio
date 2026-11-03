import {z} from 'zod';import {BusinessBenefitPolicySchema,BusinessBenefitAssessmentSchema} from './business-benefit-contract';
export const ARTIFACT_OUTCOME_METADATA_KEY='__evolutionArtifactOutcomeSubject';
export const OutcomeArtifactReferenceSchema=z.object({sourceArtifactId:z.string().min(1).max(200),blobId:z.string().min(1).max(500),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().nonnegative().max(25*1024*1024)}).strict();
const references=z.array(OutcomeArtifactReferenceSchema).min(1).max(12).superRefine((refs,ctx)=>{if(new Set(refs.map(x=>x.sourceArtifactId)).size!==refs.length)ctx.addIssue({code:'custom',message:'Duplicate artifact source identity'});});
const {version:_version,...metricPolicyShape}=BusinessBenefitPolicySchema.shape;void _version;
export const ArtifactOutcomeStudySchema=z.object({...metricPolicyShape,
 schemaVersion:z.literal('artifact-outcome-study-v1'),stableTaskIds:BusinessBenefitPolicySchema.shape.stableTaskIds.max(150),candidateTaskIds:BusinessBenefitPolicySchema.shape.candidateTaskIds.max(150),id:z.string().regex(/^[A-Za-z0-9._-]{1,70}$/),missionId:z.string().min(1),candidateId:z.string().min(1),acceptanceId:z.string().min(1),evidenceFingerprint:z.string().min(1),registeredAt:z.iso.datetime({offset:true}),originalArtifacts:references,candidateArtifacts:references,
}).strict().superRefine((p,ctx)=>{
 if(p.source!=='outcome-telemetry:artifact-study.'+p.id)ctx.addIssue({code:'custom',message:'Artifact study source must be isolated by its frozen study ID'});
 if(new Set([p.acceptanceMetricKey,p.elapsedMetricKey,p.costMetricKey]).size!==3)ctx.addIssue({code:'custom',message:'Acceptance, elapsed and cost metrics must be distinct'});
 const all=[...p.stableTaskIds,...p.candidateTaskIds];if(new Set(all).size!==all.length)ctx.addIssue({code:'custom',message:'Task IDs must be unique across both arms'});
 const left=p.originalArtifacts.map(x=>x.sourceArtifactId).sort(),right=p.candidateArtifacts.map(x=>x.sourceArtifactId).sort();if(JSON.stringify(left)!==JSON.stringify(right))ctx.addIssue({code:'custom',message:'Original and Candidate must cover the same source files'});
 if(!p.originalArtifacts.some(a=>p.candidateArtifacts.some(b=>a.sourceArtifactId===b.sourceArtifactId&&a.sha256!==b.sha256)))ctx.addIssue({code:'custom',message:'Artifact cohorts require distinct original and accepted bytes'});
});
export type ArtifactOutcomeStudy=z.infer<typeof ArtifactOutcomeStudySchema>;
export const ArtifactOutcomeSubjectSchema=z.object({schemaVersion:z.literal('artifact-outcome-subject-v1'),studyId:z.string().min(1),studyFingerprint:z.string().min(1),artifacts:references}).strict();
export const ArtifactTaskRecordSchema=z.object({taskId:z.string().trim().min(1).max(200),observedAt:z.iso.datetime({offset:true}),artifacts:references,accepted:z.boolean(),elapsedMs:z.number().finite().nonnegative(),actualCost:z.number().finite().nonnegative(),currency:z.string().regex(/^[A-Z]{3}$/)}).strict();
export type ArtifactTaskRecord=z.infer<typeof ArtifactTaskRecordSchema>;
export const ArtifactOutcomeAssessmentSchema=BusinessBenefitAssessmentSchema.omit({version:true,policyFingerprint:true}).extend({schemaVersion:z.literal('artifact-task-benefit-v1'),studyId:z.string(),missionId:z.string(),candidateId:z.string(),studyFingerprint:z.string(),artifactCustodyVerified:z.boolean(),establishesRealUserBenefit:z.literal(false)}).strict();
export type ArtifactOutcomeAssessment=z.infer<typeof ArtifactOutcomeAssessmentSchema>;

export const ArtifactTaskRecordBatchSchema=z.object({schemaVersion:z.literal('artifact-task-records-v1'),records:z.array(ArtifactTaskRecordSchema).max(500)}).strict();
export const ArtifactOutcomeRequestSchema=z.object({missionId:z.string().trim().min(1).max(200),studyId:z.string().regex(/^[A-Za-z0-9._-]{1,70}$/)}).strict();
export const ArtifactOutcomeCollectionSchema=z.object({schemaVersion:z.literal('artifact-outcome-collection-v1'),missionId:z.string(),studyId:z.string(),studyFingerprint:z.string(),reportedTasks:z.number().int().nonnegative(),insertedMetricSamples:z.number().int().nonnegative(),establishesRealUserBenefit:z.literal(false)}).strict();
