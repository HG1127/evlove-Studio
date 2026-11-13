import {requiresSandboxHtmlSourceExecution} from "@evolution/core";
import {inspectIsolatedLabRuntime} from "../isolated-lab-runtime";
import {getServerProductionRuntime,listServerActiveMissionCampaignJobs} from "./production-runtime";
import {inspectLabJobIntegrity} from "./lab-job-integrity";
import {getServerAiConnectionStatus} from "./server-ai-connection";
import {assertLabMiniMaxSubscriptionRoutes,LAB_MAX_SUBSCRIPTION_MISSION_TOKENS} from "./server-ai-lab-budget-dispatch";
import {LAB_MAX_DURATION_MS,LAB_MAX_PHYSICAL_CALLS} from "./lab-workflow-permit";
import {assessLabPhysicalCallFeasibility} from "./lab-physical-call-feasibility";

type LabRole="generation"|"judge";
type SavedModelStatus={configured:boolean;connection?:{model:string;baseUrl:string}};
type IntegritySnapshot={status:"clear"|"blocked"|"unknown";issues:ReadonlyArray<{reason:string;missionId?:string}>};
type ActiveCampaignSnapshot={activeCount:number;truncated:boolean};
type MissionSnapshot={exists:boolean;executableHtml:boolean};
type RuntimeIdentity={ready:boolean;codes:string[]};

export type LabExperimentReadinessPorts={
  inspectIdentity:(env:Record<string,string|undefined>)=>RuntimeIdentity;
  inspectJobs:()=>Promise<IntegritySnapshot>;
  inspectMission:(missionId:string)=>Promise<MissionSnapshot>;
  inspectMissionCampaigns:(missionId:string)=>Promise<ActiveCampaignSnapshot>;
  roleStatus:(role:LabRole)=>Promise<SavedModelStatus>;
};
const defaultPorts:LabExperimentReadinessPorts={
  inspectIdentity:inspectIsolatedLabRuntime,
  inspectJobs:inspectLabJobIntegrity,
  inspectMission:async missionId=>{
    const mission=await getServerProductionRuntime().missions.get(missionId);
    return {exists:Boolean(mission),executableHtml:mission?requiresSandboxHtmlSourceExecution(mission):false};
  },
  roleStatus:getServerAiConnectionStatus,
  inspectMissionCampaigns:async missionId=>{
    // The source-of-truth query is scoped to this Mission. A full page of 100
    // is NOT evidence that the inventory is complete.
    const jobs=await listServerActiveMissionCampaignJobs(missionId,100);
    return {activeCount:jobs.length,truncated:jobs.length>=100};
  },
};
const dedupe=(codes:string[])=>[...new Set(codes)];
const normalized=(value:string)=>value.trim().replace(/\/+$/,"").toLowerCase();
const normalizedModel=(value:string)=>value.trim().toLowerCase().replace(/[-_.]preview$/,"");

/**
 * Zero-spend Lab launch preflight. This is NOT a launch/approval endpoint.
 *
 * It does not invoke a provider, decrypt/report API keys to the caller, write
 * any Mission/Job/budget/Evidence, or arm an experiment. In particular a
 * successful subscription check from a previous request is NOT treated as a
 * fresh quota snapshot: actual admission and physical dispatch must recheck.
 */
export async function inspectLabThreeGenerationReadiness(
  env:Record<string,string|undefined>=process.env,
  ports:LabExperimentReadinessPorts=defaultPorts,
  now=new Date(),
){
  const blockers:string[]=[];
  const result={
    checkedAt:now.toISOString(),
    mode:"read-only" as const,
    executionAllowed:false as const,
    modelCallsPerformed:false as const,
    requiresSeparateModelAuthorization:true as const,
    providerQuotaChecked:false as const,
    physicalCallPlan:assessLabPhysicalCallFeasibility(),
    budget:{maxPhysicalCalls:LAB_MAX_PHYSICAL_CALLS,maxMissionTokens:LAB_MAX_SUBSCRIPTION_MISSION_TOKENS,
      maxDurationMinutes:LAB_MAX_DURATION_MS/60_000,minRemainingPercent:50},
    // A 3-generation + 3 independent-Judge plan alone consumes the full
    // six-call allowance. Baseline, planning, Holdout and Gate F cannot be
    // promised to fit without a separately measured physical-call plan.
    callFeasibility:{requestedGenerations:3,minimumIndependentJudgeChecks:3,
      minimumVariantAndJudgeCalls:6,remainingCallsForOtherStages:Math.max(0,LAB_MAX_PHYSICAL_CALLS-6),
      fullLifecycleWithinCallCap:"unverified" as const},
  };
  if(env.EVOLUTION_EXPERIMENT_MODE!=="isolated"){
    return {...result,status:"blocked" as const,blockers:["LAB_EXPERIMENT_MODE_REQUIRED"],
      orphanJobs:null,approvedMissionConfigured:false,missionReady:false,
      candidateScopeStatus:"not-configured" as const,candidateActiveCampaigns:null,
      unrelatedHistoricalOrphans:null,generationModel:null,judgeModel:null};
  }
  const isolation=ports.inspectIdentity(env);
  if(!isolation.ready){
    return {...result,status:"blocked" as const,blockers:dedupe(["LAB_RUNTIME_NOT_ISOLATED",...isolation.codes]),
      orphanJobs:null,approvedMissionConfigured:false,missionReady:false,
      candidateScopeStatus:"not-configured" as const,candidateActiveCampaigns:null,
      unrelatedHistoricalOrphans:null,generationModel:null,judgeModel:null};
  }
  const missionId=env.EVOLUTION_LAB_APPROVED_MISSION_ID?.trim();
  const armed=env.EVOLUTION_LAB_EXPERIMENT_ARMED==="true";
  if(!missionId)blockers.push("LAB_APPROVED_MISSION_REQUIRED");
  if(!armed)blockers.push("LAB_EXPERIMENT_NOT_ARMED");

  // All checks are read-only. Unknown results never silently become clear.
  const checks=await Promise.allSettled([
    ports.inspectJobs(),
    ports.roleStatus("generation"),
    ports.roleStatus("judge"),
    missionId?ports.inspectMission(missionId):Promise.resolve({exists:false,executableHtml:false}),
    missionId?ports.inspectMissionCampaigns(missionId):Promise.resolve({activeCount:0,truncated:false}),
  ]);
  const [integrity,gen,judge,mission,activeCampaigns]=checks;
  const jobSnapshot=integrity.status==="fulfilled"?integrity.value:undefined;
  const orphanJobs=jobSnapshot?jobSnapshot.issues.filter(item=>item.reason==="mission-missing").length:null;
  if(!jobSnapshot||jobSnapshot.status==="unknown")blockers.push("LAB_JOB_INTEGRITY_UNVERIFIED");
  else if(jobSnapshot.status!=="clear")blockers.push("LAB_ORPHAN_ACTIVE_JOBS");
  const generation=gen.status==="fulfilled"?gen.value:undefined;
  const independentJudge=judge.status==="fulfilled"?judge.value:undefined;
  if(!generation?.configured||!generation.connection)blockers.push("LAB_GENERATION_MODEL_UNAVAILABLE");
  if(!independentJudge?.configured||!independentJudge.connection)blockers.push("LAB_INDEPENDENT_JUDGE_UNAVAILABLE");
  if(generation?.connection&&independentJudge?.connection){
    const a=generation.connection,b=independentJudge.connection;
    if(normalizedModel(a.model)===normalizedModel(b.model)&&normalized(a.baseUrl)===normalized(b.baseUrl)){
      blockers.push("LAB_GENERATOR_EQUALS_JUDGE");
    }
    try{assertLabMiniMaxSubscriptionRoutes([a,b]);}
    catch{blockers.push("LAB_SAVED_MODEL_ROUTE_UNSUPPORTED");}
  }
  const missionState=mission.status==="fulfilled"?mission.value:undefined;
  if(missionId&&!missionState)blockers.push("LAB_MISSION_INSPECTION_UNAVAILABLE");
  else if(missionId&&!missionState?.exists)blockers.push("LAB_APPROVED_MISSION_NOT_FOUND");
  else if(missionId&&!missionState?.executableHtml)blockers.push("LAB_SYNTHETIC_HTML_REQUIRED");
  // Scoped review is diagnostic ONLY, never a bypass of the global integrity
  // alarm or the real start/RPC guards. Known unrelated historical orphans may
  // be reported separately; missing/unknown provenance is NOT quarantined.
  let candidateScopeStatus:"not-configured"|"unknown"|"blocked"|"reviewable-with-global-alert"|"reviewable"=
    missionId?"unknown":"not-configured";
  let candidateActiveCampaigns:number|null=null;
  let unrelatedHistoricalOrphans:number|null=null;
  if(missionId){
    const scan=activeCampaigns.status==="fulfilled"?activeCampaigns.value:undefined;
    if(scan&&Number.isSafeInteger(scan.activeCount)&&scan.activeCount>=0){
      candidateActiveCampaigns=scan.activeCount;
    }
    if(!scan||scan.truncated||candidateActiveCampaigns===null){
      blockers.push("LAB_TARGET_CAMPAIGNS_UNVERIFIED");
    }else if(candidateActiveCampaigns>0){
      candidateScopeStatus="blocked";
      blockers.push("LAB_TARGET_MISSION_ALREADY_ACTIVE");
    }else if(!missionState){
      candidateScopeStatus="unknown";
    }else if(!missionState.exists||!missionState.executableHtml){
      candidateScopeStatus="blocked";
    }else if(!jobSnapshot||jobSnapshot.status==="unknown"){
      candidateScopeStatus="unknown";
    }else{
      const issues=jobSnapshot.issues;
      const badIssue=issues.some(issue=>issue.reason!=="mission-missing"
        ||typeof issue.missionId!=="string"||!issue.missionId);
      if(badIssue||(jobSnapshot.status==="blocked"&&issues.length===0)
        ||(jobSnapshot.status==="clear"&&issues.length>0)){
        candidateScopeStatus="unknown";
      }else if(issues.some(issue=>issue.missionId===missionId)){
        candidateScopeStatus="blocked";
        blockers.push("LAB_TARGET_MISSION_HAS_ORPHAN_JOB");
      }else{
        unrelatedHistoricalOrphans=issues.length;
        candidateScopeStatus=issues.length?"reviewable-with-global-alert":"reviewable";
      }
    }
  }
  return {
    ...result,status:blockers.length?"blocked" as const:"preflight-clear" as const,
    blockers:dedupe(blockers),
    orphanJobs,candidateScopeStatus,candidateActiveCampaigns,unrelatedHistoricalOrphans,
    approvedMissionConfigured:Boolean(missionId),missionReady:Boolean(missionId&&missionState?.exists&&missionState.executableHtml),
    generationModel:generation?.connection?.model??null,
    judgeModel:independentJudge?.connection?.model??null,
  };
}
