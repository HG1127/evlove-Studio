import {z} from "zod";
import {AcceptanceCriterionSchema,TestCaseSchema} from "./evolve-schemas";
import {PairedJudgeContextSchema,PairedJudgeReceiptSchema} from "./paired-judge-contract";
const id=z.string().min(1).max(240),hash=z.string().regex(/^[a-f0-9]{64}$/);
const commit=z.string().regex(/^[a-f0-9]{40}$/);
const anchor=z.object({criterionId:id,arm:z.enum(["original","candidate"]),sourceArtifactId:id,sourceSha256:hash,
 startUtf16:z.number().int().nonnegative(),endUtf16:z.number().int().positive(),quoteSha256:hash,
 scope:z.enum(["source-text","native-fact"]),assertionId:id.optional()}).strict().refine(a=>a.endUtf16>a.startUtf16)
 .refine(a=>a.scope!=="native-fact"||Boolean(a.assertionId));
const planFields={
 id,preregistrationSha256:hash,oracleApprovalSha256:hash,registeredAt:z.iso.datetime({offset:true}),
 sourceCommit:commit,scoringRouteFingerprint:id,rubricFingerprint:id,suiteFingerprint:id,
 paperUse:z.literal("diagnostic-only"),applicationScenarioSha256:hash,confirmationWindowMs:z.number().int().positive().max(1800000),maxHeartbeatGapMs:z.number().positive().max(30000),testCases:z.array(TestCaseSchema).min(1).max(100),criteria:z.array(AcceptanceCriterionSchema).min(1).max(32),
};
const controlFields={id,kind:z.enum(["identical","known-improvement","known-regression"]),
 minAbsoluteDelta:z.number().int().min(1).max(100)};
export const JudgeCalibrationPlanV1Schema=z.object({schemaVersion:z.literal("judge-calibration-plan-v1"),...planFields,
 controls:z.array(z.object({...controlFields,
  expectations:z.array(z.object({criterionId:id,direction:z.enum(["same","improve","regress"])}).strict()).min(1).max(32),
  context:PairedJudgeContextSchema,anchors:z.array(anchor).min(2).max(256),
 }).strict()).min(3).max(96),
}).strict().refine(p=>new Set(p.criteria.map(c=>c.id)).size===p.criteria.length)
 .refine(p=>new Set(p.controls.map(c=>c.id)).size===p.controls.length);
/** Opt-in zero-reference contrast. It cannot reinterpret a v1 oracle or an already observed control. */
export const JudgeCalibrationPlanV2Schema=z.object({schemaVersion:z.literal("judge-calibration-plan-v2"),...planFields,
 controls:z.array(z.object({...controlFields,
  expectations:z.array(z.object({criterionId:id,direction:z.enum(["same","improve","regress","no-improvement"])}).strict()).min(1).max(32),
  context:PairedJudgeContextSchema,anchors:z.array(anchor).min(2).max(256),
 }).strict()).min(3).max(96),
}).strict().refine(p=>new Set(p.criteria.map(c=>c.id)).size===p.criteria.length)
 .refine(p=>new Set(p.controls.map(c=>c.id)).size===p.controls.length)
 .superRefine((p,ctx)=>{
  for(const [i,control] of p.controls.entries())for(const [j,expectation] of control.expectations.entries()){
   if(expectation.direction!=="no-improvement")continue;
   const criterion=p.criteria.find(c=>c.id===expectation.criterionId);
   if(control.kind!=="known-regression"||criterion?.judgeType!=="pairwise"||criterion.protectedConstraint
    ||criterion.minScore<=0||criterion.category!=="outcome")
    ctx.addIssue({code:"custom",path:["controls",i,"expectations",j],message:"Zero-reference non-improvement requires a known-regression pairwise outcome criterion with a positive threshold; it cannot replace absolute or protection regression contrasts"});
  }
 });
/** Absolute labels are independent oracle data, never supplied by the model under test. */
export const JudgeCalibrationPlanV3Schema=z.object({schemaVersion:z.literal("judge-calibration-plan-v3"),...planFields,
 controls:z.array(z.object({...controlFields,
  expectations:z.array(z.object({criterionId:id,direction:z.enum(["same","improve","regress","no-improvement"]),
   originalPass:z.boolean(),candidatePass:z.boolean()}).strict()).min(1).max(32),
  context:PairedJudgeContextSchema,anchors:z.array(anchor).min(2).max(256),
 }).strict()).min(3).max(96),
}).strict().refine(p=>new Set(p.criteria.map(c=>c.id)).size===p.criteria.length)
 .refine(p=>new Set(p.controls.map(c=>c.id)).size===p.controls.length)
 .superRefine((p,ctx)=>{
  p.criteria.forEach((c,i)=>{if(c.minScore<=0)ctx.addIssue({code:"custom",path:["criteria",i,"minScore"],message:"Absolute numeric threshold calibration needs a positive unchanged minimum"});});
  for(const [i,control] of p.controls.entries())for(const [j,e] of control.expectations.entries()){
   const criterion=p.criteria.find(c=>c.id===e.criterionId),path=["controls",i,"expectations",j];
   if(e.direction==="no-improvement"&&(control.kind!=="known-regression"||criterion?.judgeType!=="pairwise"
    ||criterion.protectedConstraint||criterion.category!=="outcome"||e.originalPass||e.candidatePass))
    ctx.addIssue({code:"custom",path,message:"Zero-reference non-improvement needs a non-protected pairwise outcome and two absolute failures"});
   if(e.direction==="same"&&e.originalPass!==e.candidatePass||e.direction==="improve"&&!e.candidatePass
    ||e.direction==="regress"&&!e.originalPass&&e.candidatePass)
    ctx.addIssue({code:"custom",path,message:"Absolute oracle labels contradict the registered direction"});
  }
 });
/** Opt-in preservation-aware coverage. V3 absolute labels and all score gates remain unchanged. */
export const JudgeCalibrationPlanV4Schema=z.object({...JudgeCalibrationPlanV3Schema.shape,
 schemaVersion:z.literal("judge-calibration-plan-v4"),sourceArtifactCount:z.number().int().min(1).max(64),
 preservationCriterionIds:z.array(id).max(32).refine(values=>new Set(values).size===values.length,"Duplicate preservation criterion"),
}).strict().superRefine((p,ctx)=>{
 const {sourceArtifactCount,preservationCriterionIds,...legacy}=p;
 const checked=JudgeCalibrationPlanV3Schema.safeParse({...legacy,schemaVersion:"judge-calibration-plan-v3"});
 if(!checked.success)for(const issue of checked.error.issues)ctx.addIssue({code:"custom",path:issue.path,message:issue.message});
 const boundIds=new Set(p.controls.flatMap(c=>c.context.bindings.map(b=>b.sourceArtifactId)));
 if(sourceArtifactCount<boundIds.size)ctx.addIssue({code:"custom",path:["sourceArtifactCount"],message:"Source count cannot omit bound artifacts"});
 if(preservationCriterionIds.some(id=>!p.criteria.some(c=>c.id===id)))ctx.addIssue({code:"custom",path:["preservationCriterionIds"],message:"Unknown preservation criterion"});
});
export const JudgeCalibrationPlanSchema=z.discriminatedUnion("schemaVersion",[JudgeCalibrationPlanV1Schema,JudgeCalibrationPlanV2Schema,JudgeCalibrationPlanV3Schema,JudgeCalibrationPlanV4Schema]);
/** Immutable canonical evidence still needs the trusted preregistration/independence verifier. */
export const JudgeCalibrationApprovalEvidenceSchema=z.object({schemaVersion:z.literal("judge-calibration-approval-v1"),
 kind:z.enum(["preregistration","independent-oracle-approval"]),planSha256:hash,recordedAt:z.iso.datetime({offset:true}),
}).strict();
export const JudgeCalibrationObservationSchema=z.object({schemaVersion:z.literal("judge-calibration-observation-v1"),
 controlId:id,firstRequestAt:z.iso.datetime({offset:true}),completedAt:z.iso.datetime({offset:true}),
 receipt:PairedJudgeReceiptSchema}).strict();
export const ApplicationLifetimeEvidenceSchema=z.object({schemaVersion:z.literal("application-lifetime-evidence-v1"),
 scope:z.literal("application-load"),sourceCommit:commit,scenarioSha256:hash,eventsSha256:hash,
 faultInjectionEvidenceSha256:hash,startedAt:z.iso.datetime({offset:true}),completedAt:z.iso.datetime({offset:true}),
 observedComponents:z.array(z.enum(["backend","control-loop","native-runner"])).length(3),
 exitCode:z.number().int(),deadlineStop:z.boolean(),automaticRestart:z.literal(false),
 logsComplete:z.boolean(),maximumHeartbeatGapMs:z.number().nonnegative(),
}).strict().refine(p=>new Set(p.observedComponents).size===3);
const admissionFields={
 sourceCommit:commit,scoringRouteFingerprint:id,rubricFingerprint:id,suiteFingerprint:id,
 calibrationPlanId:id,applicationScenarioSha256:hash,applicationEvidenceSha256:hash,maxHeartbeatGapMs:z.number().positive().max(30000),
 plannedWindowMs:z.number().int().positive().max(1800000)};
export const ConfirmationAdmissionRequestV1Schema=z.object({schemaVersion:z.literal("confirmation-admission-request-v1"),...admissionFields}).strict();
export const ConfirmationAdmissionRequestV2Schema=z.object({schemaVersion:z.literal("confirmation-admission-request-v2"),...admissionFields,
 requiredCalibrationVersion:z.literal("judge-calibration-plan-v3")}).strict();
export const ConfirmationAdmissionRequestV3Schema=z.object({schemaVersion:z.literal("confirmation-admission-request-v3"),...admissionFields,
 requiredCalibrationVersion:z.literal("judge-calibration-plan-v4"),sourceArtifactCount:z.number().int().min(1).max(64)}).strict();
export const ConfirmationAdmissionRequestSchema=z.discriminatedUnion("schemaVersion",[ConfirmationAdmissionRequestV1Schema,ConfirmationAdmissionRequestV2Schema,ConfirmationAdmissionRequestV3Schema]);
export type JudgeCalibrationPlan=z.infer<typeof JudgeCalibrationPlanSchema>;
export type JudgeCalibrationObservation=z.infer<typeof JudgeCalibrationObservationSchema>;
export type ConfirmationAdmissionRequest=z.infer<typeof ConfirmationAdmissionRequestSchema>;
/** Composition roots must verify canonical evidence identities; local caller assertions do not certify a Mission. */
export interface ConfirmationAdmissionPorts {
 readCalibrationPlan(id:string):Promise<unknown>;
 readCalibrationObservations(id:string):Promise<unknown[]>;
 verifyPreregistration(sha256:string):Promise<boolean>;
 verifyOracleApproval(sha256:string):Promise<boolean>;
 readApplicationEvidence(sha256:string):Promise<unknown>;
 verifyEvidenceArtifact(sha256:string):Promise<boolean>;
 readText(sha256:string):Promise<string>;
 sha256Utf8(text:string):Promise<string>;
}
