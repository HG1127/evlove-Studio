import {AttentionRequestSchema,EvaluationResultSchema,EvolutionJobSchema} from "@evolution/contracts";
import {baselinePolicyTransitionFixture} from "./baseline-policy-transition-fixture";

/** Synthetic completed diagnostic paper paused only by a provider availability outage. */
export function recoveredControlAiFixture(){
  const at="2026-10-19T00:00:00.000Z",project=baselinePolicyTransitionFixture();
  project.id="recovered-mission";project.updatedAt=at;project.stage="diagnosis";
  project.candidates=[];project.searchChampion=undefined;project.evolutionArchive=[];project.selectedCandidateIds=[];
  project.baselineRun={...project.baselineRun,id:"retained-baseline",status:"completed",startedAt:at,completedAt:at,
    result:EvaluationResultSchema.parse({accuracy:81,evidence:86,riskCoverage:78,safety:"PASS",completeness:82,averageCost:0,averageLatencyMs:1,rubricScore:81,verifiedRubricCoverage:90})};
  project.experimentRun={...project.experimentRun,status:"idle",candidateResults:[],winnerId:undefined};
  project.validationRun={...project.validationRun,status:"idle",candidateId:undefined,runs:[],baselineRuns:[],evaluation:undefined,baselineEvaluation:undefined};
  project.artifactAcceptance={...project.artifactAcceptance,status:"idle",attempts:0,hardGatePass:false,candidateId:undefined,frozenArtifacts:undefined,acceptedAt:undefined};
  project.campaign={...project.campaign,status:"paused",currentRound:0,startedAt:at,stopReason:"Synthetic provider timeout",checkpoint:{round:1,completedPhase:"diagnose",at},
    scoringInputFingerprint:undefined,scoringRouteFingerprint:undefined,serverRecoveryWait:undefined};
  project.attentionRequests=[AttentionRequestSchema.parse({id:"server-ai-capability-server-checkpoint-recovered",type:"capability",status:"pending",title:"Synthetic provider",reason:project.campaign.stopReason,stage:project.stage,blocking:true,createdAt:at})];
  const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"recovered-control",missionId:project.id,type:"campaign",status:"running",label:"Synthetic failed recovered control",generation:1,idempotencyKey:"workflow-control:"+project.id+":recovered",outputRef:"recovered-run",createdAt:at,updatedAt:at});
  project.campaign.serverControlOwner={schemaVersion:"server-workflow-control-owner-v1",controlJobId:job.id,operationKey:job.idempotencyKey,sourceUpdatedAt:at,inputFingerprint:"a".repeat(64),requestedAt:at,phase:"bound",runId:"recovered-run"};
  return {project,job,at};
}