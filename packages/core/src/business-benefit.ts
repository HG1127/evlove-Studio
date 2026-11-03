import { BusinessBenefitAssessmentSchema, BusinessBenefitPolicySchema, type BusinessBenefitAssessment, type BusinessBenefitPolicy, type OutcomeMetricSample } from "@evolution/contracts";
import { fastHash } from "./stable-hash";

export const businessBenefitPolicyFingerprint = (policy: BusinessBenefitPolicy) => fastHash(JSON.stringify(BusinessBenefitPolicySchema.parse(policy)));

import {assessTaskBenefitCohorts,thresholdChecks} from './business-benefit-cohorts';

type ArmSummary=BusinessBenefitAssessment['stable'];
/** A receipt's claimed status cannot override its counts or numeric thresholds. */
export function businessBenefitEvidenceMatches(policy: BusinessBenefitPolicy, proof: BusinessBenefitAssessment) {
  const armValid = (s: ArmSummary, expected: number) => s.expectedTasks === expected && s.completeTasks === expected
    && s.acceptedTasks !== undefined && s.acceptedTasks > 0 && s.acceptedTasks <= expected
    && s.acceptanceRate === s.acceptedTasks / expected && s.reportedTotalCost !== undefined && s.reportedCostPerAccepted !== undefined
    && Math.abs(s.reportedCostPerAccepted - s.reportedTotalCost / s.acceptedTasks) <= 1e-12;
  return proof.status === "thresholds-met" && proof.policyFingerprint === businessBenefitPolicyFingerprint(policy)
    && proof.conflictCount === 0 && proof.unexpectedTaskCount === 0 && proof.pendingTaskCount === 0
    && armValid(proof.stable, policy.stableTaskIds.length) && armValid(proof.candidate, policy.candidateTaskIds.length)
    && Object.values(proof.checks).every(Boolean) && Object.values(thresholdChecks(proof.stable, proof.candidate, true)).every(Boolean);
}

/** All attempted tasks retain the original deployment-bound v1 scope and numeric gates. */
export function assessBusinessBenefit(input:{policy:BusinessBenefitPolicy;samples:OutcomeMetricSample[];checkedAt:string;configurationError?:string}){
 const policy=BusinessBenefitPolicySchema.parse(input.policy);
 return BusinessBenefitAssessmentSchema.parse({version:policy.version,policyFingerprint:businessBenefitPolicyFingerprint(policy),...assessTaskBenefitCohorts({...input,policy,scopeMatches:rows=>{
  const cohortScope=new Set(rows.map(s=>JSON.stringify([s.workspaceId,s.missionId,s.candidateId]))),deployments=(arm:'stable'|'candidate')=>new Set(rows.filter(s=>s.arm===arm).map(s=>s.deploymentId??''));
  const stable=deployments('stable'),candidate=deployments('candidate');return cohortScope.size===1&&stable.size===1&&candidate.size===1&&!stable.has('')&&!candidate.has('')&&[...stable][0]!==[...candidate][0];
 }})});
}
