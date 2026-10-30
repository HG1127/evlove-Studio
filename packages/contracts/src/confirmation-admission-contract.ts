import {z} from "zod";
import {AcceptanceCriterionSchema,TestCaseSchema} from "./evolve-schemas";
import {PairedJudgeContextSchema,PairedJudgeReceiptSchema} from "./paired-judge-contract";
const id=z.string().min(1).max(240),hash=z.string().regex(/^[a-f0-9]{64}$/);
const commit=z.string().regex(/^[a-f0-9]{40}$/);
const anchor=z.object({criterionId:id,arm:z.enum(["original","candidate"]),sourceArtifactId:id,sourceSha256:hash,
 startUtf16:z.number().int().nonnegative(),endUtf16:z.number().int().positive(),quoteSha256:hash,
 scope:z.enum(["source-text","native-fact"]),assertionId:id.optional()}).strict().refine(a=>a.endUtf16>a.startUtf16)
 .refine(a=>a.scope!=="native-fact"||Boolean(a.assertionId));
export const JudgeCalibrationPlanSchema=z.object({schemaVersion:z.literal("judge-calibration-plan-v1"),
 id,preregistrationSha256:hash,oracleApprovalSha256:hash,registeredAt:z.iso.datetime({offset:true}),
 sourceCommit:commit,scoringRouteFingerprint:id,rubricFingerprint:id,suiteFingerprint:id,
 paperUse:z.literal("diagnostic-only"),applicationScenarioSha256:hash,confirmationWindowMs:z.number().int().positive().max(1800000),maxHeartbeatGapMs:z.number().positive().max(30000),testCases:z.array(TestCaseSchema).min(1).max(100),criteria:z.array(AcceptanceCriterionSchema).min(1).max(32),
 controls:z.array(z.object({id,kind:z.enum(["identical","known-improvement","known-regression"]),
  minAbsoluteDelta:z.number().int().min(1).max(100),expectations:z.array(z.object({criterionId:id,direction:z.enum(["same","improve","regress"])}).strict()).min(1).max(32),context:PairedJudgeContextSchema,
  anchors:z.array(anchor).min(2).max(256)}).strict()).min(3).max(96),
}).strict().refine(p=>new Set(p.criteria.map(c=>c.id)).size===p.criteria.length)
 .refine(p=>new Set(p.controls.map(c=>c.id)).size===p.controls.length);
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
export const ConfirmationAdmissionRequestSchema=z.object({schemaVersion:z.literal("confirmation-admission-request-v1"),
 sourceCommit:commit,scoringRouteFingerprint:id,rubricFingerprint:id,suiteFingerprint:id,
 calibrationPlanId:id,applicationScenarioSha256:hash,applicationEvidenceSha256:hash,maxHeartbeatGapMs:z.number().positive().max(30000),
 plannedWindowMs:z.number().int().positive().max(1800000)}).strict();
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
