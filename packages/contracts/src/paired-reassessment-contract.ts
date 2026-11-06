import {z} from "zod";
import {AiUsageRouteSchema} from "./ai-usage-contract";

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().min(1).max(240);
/** Out-of-band registrar attestations only. This is never a client Mission field. */
export const PairedReassessmentPinSchema=z.object({
  missionId:id,physicalScopeSha256:digest,runtimeCommit:z.string().regex(/^[a-f0-9]{40}$/),
  priorClaimId:id,priorClaimPayloadSha256:digest,priorJobId:id,
  priorFailureEventId:id,priorFailurePayloadSha256:digest,
  priorPhysicalRoute:AiUsageRouteSchema,
  targetScoringRouteFingerprint:digest,targetPhysicalRoute:AiUsageRouteSchema,
  qualificationOutcomeSha256:digest,qualificationAuditSha256:digest,authorizationSha256:digest,
  reason:z.literal("qualified-evaluator-replacement-after-schema-failure"),
  expiresAt:z.iso.datetime(),
}).strict().superRefine((pin,ctx)=>{
  if(pin.priorPhysicalRoute.operation!=="evaluate-paired"||pin.targetPhysicalRoute.operation!=="evaluate-paired"
    ||pin.priorPhysicalRoute.model===pin.targetPhysicalRoute.model
    ||pin.priorPhysicalRoute.routeFingerprint===pin.targetPhysicalRoute.routeFingerprint)
    ctx.addIssue({code:"custom",message:"A replacement requires distinct, explicitly qualified evaluator routes"});
});
export type PairedReassessmentPin=z.infer<typeof PairedReassessmentPinSchema>;
export const PairedReassessmentTrustSchema=z.object({
  schemaVersion:z.literal("paired-reassessment-trust-v1"),
  pins:z.array(PairedReassessmentPinSchema).min(1).max(50),
}).strict().superRefine((trust,ctx)=>{
  const keys=trust.pins.map(pin=>JSON.stringify([pin.missionId,pin.physicalScopeSha256,pin.targetScoringRouteFingerprint]));
  if(new Set(keys).size!==keys.length)ctx.addIssue({code:"custom",message:"Duplicate reassessment target"});
});
