import {ApplicationLifetimeEvidenceSchema,ConfirmationAdmissionRequestSchema,JudgeCalibrationObservationSchema,JudgeCalibrationPlanSchema,
 type ConfirmationAdmissionPorts} from "@evolution/contracts";
import {assessMeasurementCalibration} from "@evolution/core";

/** Read-only admission. Never starts a model, repairs a Job, or spends a fresh comparison claim. */
export async function checkFullConfirmationAdmission(raw:unknown,ports:ConfirmationAdmissionPorts){
 const request=ConfirmationAdmissionRequestSchema.parse(raw),blockers:string[]=[];
 const plan=JudgeCalibrationPlanSchema.parse(await ports.readCalibrationPlan(request.calibrationPlanId));
 if(plan.id!==request.calibrationPlanId||plan.sourceCommit!==request.sourceCommit
  ||plan.scoringRouteFingerprint!==request.scoringRouteFingerprint||plan.rubricFingerprint!==request.rubricFingerprint
  ||plan.suiteFingerprint!==request.suiteFingerprint||plan.applicationScenarioSha256!==request.applicationScenarioSha256||plan.confirmationWindowMs!==request.plannedWindowMs||plan.maxHeartbeatGapMs!==request.maxHeartbeatGapMs)blockers.push("Calibration does not bind the intended exact code/model/rubric/paper");
 if(!await ports.verifyPreregistration(plan.preregistrationSha256)||!await ports.verifyOracleApproval(plan.oracleApprovalSha256))
  blockers.push("Fixed control preregistration or independent oracle approval is unverified");
 const observations=(await ports.readCalibrationObservations(plan.id)).map(o=>JudgeCalibrationObservationSchema.parse(o));
 for(const control of plan.controls)for(const anchor of control.anchors){
  const text=await ports.readText(anchor.sourceSha256);
  if(await ports.sha256Utf8(text)!==anchor.sourceSha256||anchor.endUtf16>text.length
    ||await ports.sha256Utf8(text.slice(anchor.startUtf16,anchor.endUtf16))!==anchor.quoteSha256)
   blockers.push("Original-source anchor bytes differ: "+control.id+"/"+anchor.criterionId);
 }
 const calibration=assessMeasurementCalibration(plan,observations);blockers.push(...calibration.blockers);
 const app=ApplicationLifetimeEvidenceSchema.safeParse(await ports.readApplicationEvidence(request.applicationEvidenceSha256));
 if(!app.success)blockers.push("Application-load evidence missing; idle process lifetime cannot satisfy it");
 else{
  const p=app.data,duration=Date.parse(p.completedAt)-Date.parse(p.startedAt);
  if(p.sourceCommit!==request.sourceCommit||p.scenarioSha256!==request.applicationScenarioSha256||duration<request.plannedWindowMs||p.exitCode!==0||p.deadlineStop
    ||!p.logsComplete||p.maximumHeartbeatGapMs>request.maxHeartbeatGapMs
    ||!await ports.verifyEvidenceArtifact(p.scenarioSha256)||!await ports.verifyEvidenceArtifact(request.applicationEvidenceSha256)
    ||!await ports.verifyEvidenceArtifact(p.eventsSha256)||!await ports.verifyEvidenceArtifact(p.faultInjectionEvidenceSha256))
   blockers.push("Exact application lifetime/fault/health/output evidence is unqualified");
 }
 return {schemaVersion:"full-confirmation-admission-v1" as const,ready:blockers.length===0,blockers,
  sourceCommit:request.sourceCommit,scoringRouteFingerprint:request.scoringRouteFingerprint,calibrationPlanId:plan.id,
  applicationEvidenceSha256:request.applicationEvidenceSha256,
  grantsNewTrialAuthority:false,grantsModelBudget:false,technicalAcceptanceEstablished:false};
}
