import {
  OutcomeMetricBatchRequestSchema,
  type EvolveProject,
  type OutcomeArm,
  type OutcomeMetricBatchRequest,
} from "@evolution/contracts";
import {PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS} from "@evolution/core";

function fail(message:string):never{
  const error=new Error(message);
  (error as Error&{code?:string}).code="OUTCOME_SAMPLE_BINDING_MISMATCH";
  throw error;
}

function releaseDeploymentForArm(project:EvolveProject,arm:OutcomeArm){
  const stable=project.release.stableDeploymentId;
  const candidate=project.release.deploymentId;
  if(stable&&candidate&&stable===candidate){
    const expectedArm:OutcomeArm=project.release.status==="rolled-back"?"stable":"candidate";
    if(arm!==expectedArm){
      fail("Outcome sample arm "+arm+" does not match single active deployment role "+expectedArm);
    }
    return stable;
  }
  const deploymentId=arm==="stable"?stable:candidate;
  if(!deploymentId)fail("Outcome sample "+arm+" arm has no bound Release deployment");
  return deploymentId;
}

export function bindOutcomeMetricBatchToMission(
  project:EvolveProject,
  raw:OutcomeMetricBatchRequest,
  options?:{now?:number;maxFutureSkewMs?:number},
):OutcomeMetricBatchRequest{
  const input=OutcomeMetricBatchRequestSchema.parse(raw);
  if(input.missionId!==project.id)fail("Outcome batch missionId does not match Mission");
  const candidateId=project.release.candidateId;
  if(!candidateId)fail("Mission has no exact Release Candidate for Outcome ingestion");
  if(input.candidateId&&input.candidateId!==candidateId){
    fail("Outcome batch candidateId does not match current Release Candidate");
  }
  const now=options?.now??Date.now();
  const maxFutureSkewMs=options?.maxFutureSkewMs??PRODUCTION_OUTCOME_MAX_FUTURE_SKEW_MS;
  const samples=input.samples.map((sample,index)=>{
    if(sample.candidateId&&sample.candidateId!==candidateId){
      fail("Outcome sample "+index+" candidateId does not match current Release Candidate");
    }
    const expectedDeploymentId=releaseDeploymentForArm(project,sample.arm);
    if(!sample.deploymentId)fail("Outcome sample "+index+" requires exact deploymentId");
    if(sample.deploymentId!==expectedDeploymentId){
      fail("Outcome sample "+index+" deploymentId "+sample.deploymentId+" does not match "+sample.arm+" deployment "+expectedDeploymentId);
    }
    const observedMs=Date.parse(sample.observedAt);
    if(!Number.isFinite(observedMs))fail("Outcome sample "+index+" observedAt is invalid");
    if(observedMs>now+maxFutureSkewMs){
      fail("Outcome sample "+index+" observedAt exceeds allowed future clock skew");
    }
    return {...sample,candidateId,deploymentId:expectedDeploymentId};
  });
  return {...input,candidateId,samples};
}

export function resolveOutcomeAnalysisCandidate(project:EvolveProject,requestedCandidateId?:string){
  const requested=requestedCandidateId?.trim();
  if(requested)return requested;
  const current=project.release.candidateId;
  if(!current)fail("Mission has no current Release Candidate; candidateId is required for Outcome analysis");
  return current;
}
