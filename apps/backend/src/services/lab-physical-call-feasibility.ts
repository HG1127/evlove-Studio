import {LAB_MAX_PHYSICAL_CALLS} from "./lab-workflow-permit";

/**
 * P3-V source-level, zero-provider-I/O budget evidence.
 *
 * These are POTENTIAL call sites, not observations and not claims that the
 * whole stage will run. The real Workflow, provider transport and Ledger
 * remain the authority for a physical HTTP attempt.
 */
export const LAB_MODEL_CALL_SITES=[
  {phase:"preparation",operation:"understand",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("understand"',scope:"conditional"},
  {phase:"preparation",operation:"rubric",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("rubric"',scope:"conditional"},
  {phase:"preparation",operation:"eval-suite",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("eval-suite"',scope:"conditional"},
  {phase:"planning",operation:"problem-analysis",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("problem-analysis"',scope:"conditional"},
  {phase:"planning",operation:"diagnose",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("diagnose"',scope:"conditional"},
  {phase:"planning",operation:"plan",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("plan"',scope:"conditional"},
  {phase:"baseline",operation:"execute-artifact-batch",source:"apps/backend/src/services/server-baseline.ts",expression:'runServerAi("execute-artifact-batch"',scope:"conditional"},
  {phase:"baseline",operation:"evaluate",source:"apps/backend/src/services/server-evidence-judge.ts",expression:'runServerAi("evaluate"',scope:"conditional"},
  {phase:"candidate",operation:"build-candidate",source:"apps/backend/src/services/server-experiment-artifacts.ts",expression:'runServerAi("build-candidate"',scope:"conditional"},
  {phase:"candidate",operation:"repair-artifact",source:"apps/backend/src/services/server-artifact-acceptance.ts",expression:'runServerAi("repair-artifact"',scope:"conditional"},
  {phase:"candidate",operation:"execute-artifact-batch",source:"apps/backend/src/services/server-experiment.ts",expression:'runServerAi("execute-artifact-batch"',scope:"conditional"},
  {phase:"candidate",operation:"evaluate",source:"apps/backend/src/services/server-evidence-judge.ts",expression:'runServerAi("evaluate"',scope:"conditional"},
  {phase:"paired-judge",operation:"evaluate-paired",source:"apps/backend/src/services/server-paired-evidence-judge.ts",expression:'runServerAi("evaluate-paired"',scope:"conditional"},
  {phase:"holdout",operation:"execute-artifact-batch",source:"apps/backend/src/services/server-holdout.ts",expression:'runServerAi("execute-artifact-batch"',scope:"conditional"},
  {phase:"holdout",operation:"release-review",source:"apps/backend/src/services/server-holdout.ts",expression:'runServerAi("release-review"',scope:"conditional"},
  {phase:"independent-final",operation:"eval-suite",source:"workflows/evolution-mission/steps.ts",expression:'reserveServerMissionFinalPaper(',scope:"conditional"},
  {phase:"independent-final",operation:"holdout",source:"apps/backend/src/services/server-independent-final-holdout.ts",expression:"execute=runServerMissionHoldout",scope:"conditional"},
  {phase:"post-run",operation:"distill",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("distill"',scope:"conditional"},
  {phase:"post-run",operation:"next-queue",source:"workflows/evolution-mission/steps.ts",expression:'runServerAi("next-queue"',scope:"conditional"},
] as const;

export const LAB_PHYSICAL_ATTEMPT_GUARDS=[
  {kind:"physical-http-attempt",source:"apps/backend/src/services/server-ai-usage.ts",expression:"reserveLabAiDispatchAttempt({"},
  {kind:"transport-retry",source:"packages/adapters/src/ai-provider-request.ts",expression:"await observer?.beforeAttempt(attempt+1)"},
  {kind:"structured-output-correction",source:"apps/backend/src/services/ai-gateway.ts",expression:"serverAiFormatCorrectionAllowed()"},
  {kind:"candidate-build-correction",source:"apps/backend/src/services/server-experiment-artifacts.ts",expression:'runServerAi("build-candidate",{...payload,constructionCorrection:correction}'},
  {kind:"candidate-repair-correction",source:"apps/backend/src/services/server-artifact-acceptance.ts",expression:'runServerAi("repair-artifact",{...payload,constructionCorrection:'},
  {kind:"judge-shard-fallback",source:"apps/backend/src/services/server-evidence-judge.ts",expression:"for(const criteria of chunks)"},
  {kind:"paired-order-judge",source:"apps/backend/src/services/server-paired-evidence-judge.ts",expression:"for(let index=0;index<2;index++)"},
] as const;

export type LabCallBudgetScenario={
  requestedGenerations:number;
  independentJudgeChecks:number;
  additionalModelCalls:number;
};

/**
 * Pure nominal scenario arithmetic, NOT a computed price, quota lookup, or
 * the real model budget reservation. Every HTTP attempt separately reserves
 * against the unchanged authoritative six-call SQL budget.
 */
export function assessLabPhysicalCallFeasibility(
  scenario:LabCallBudgetScenario={requestedGenerations:3,independentJudgeChecks:3,additionalModelCalls:0},
){
  const {requestedGenerations,independentJudgeChecks,additionalModelCalls}=scenario;
  for(const value of [requestedGenerations,independentJudgeChecks,additionalModelCalls]){
    if(!Number.isSafeInteger(value)||value<0||value>10_000){
      throw new Error("Lab physical call scenario must use bounded nonnegative integers");
    }
  }
  // The user's proposed experiment assumes one successful physical request per
  // generation and one per independent Judge observation. Actual transport,
  // validation, plan, Holdout and Gate F can demand more.
  const nominalCore=requestedGenerations+independentJudgeChecks;
  const nominalWithExtras=nominalCore+additionalModelCalls;
  return {
    schemaVersion:"lab-call-feasibility-v1" as const,
    kind:"unbilled-scenario" as const,
    performedProviderRequests:false as const,
    executedMission:false as const,
    maxPhysicalCalls:LAB_MAX_PHYSICAL_CALLS,
    requestedGenerations,independentJudgeChecks,
    nominalCoreCalls:nominalCore,
    additionalModelCalls,
    nominalTotalCalls:nominalWithExtras,
    remainingCalls:Math.max(0,LAB_MAX_PHYSICAL_CALLS-nominalWithExtras),
    nominalOverflowCalls:Math.max(0,nominalWithExtras-LAB_MAX_PHYSICAL_CALLS),
    nominalFitsWithinCap:nominalWithExtras<=LAB_MAX_PHYSICAL_CALLS,
    extraCallsWithoutOverflow:Math.max(0,LAB_MAX_PHYSICAL_CALLS-nominalCore),
    fullLifecycleProven:false as const,
    modelCallsNotStaticallyBound:true as const,
    possibleAiPhases:LAB_MODEL_CALL_SITES.map(({phase})=>phase).filter((v,i,a)=>a.indexOf(v)===i),
    attemptAmplification:LAB_PHYSICAL_ATTEMPT_GUARDS.map(({kind})=>kind),
    recommendation:nominalWithExtras>LAB_MAX_PHYSICAL_CALLS
      ?"BLOCK_NOMINAL_OVER_BUDGET" as const
      :nominalWithExtras===LAB_MAX_PHYSICAL_CALLS
        ?"CORE_AT_CAP_NO_RETRY_HEADROOM" as const
        :"CONDITIONAL_SPARE_CAPACITY_NOT_EXECUTION_APPROVAL" as const,
  };
}
