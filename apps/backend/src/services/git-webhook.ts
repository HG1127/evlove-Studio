import {createEvolutionEvent,type EvolveProject} from "@evolution/contracts";
import {evolutionGitBranch} from "./github-target";

type Json=Record<string,unknown>;

function record(value:unknown){return typeof value==="object"&&value!==null?value as Json:undefined;}
function text(value:unknown){return typeof value==="string"&&value.trim()?value:undefined;}
function positiveInteger(value:unknown){return typeof value==="number"&&Number.isInteger(value)&&value>0?value:undefined;}
function sha(value:unknown){const valueText=text(value);return valueText&&!/^0+$/.test(valueText)?valueText:undefined;}
function nestedText(value:unknown,...keys:string[]){
  let current:unknown=value;
  for(const key of keys){const item=record(current);if(!item)return undefined;current=item[key];}
  return text(current);
}

export type GitWebhookContext={
  event:string;repository:string;branch?:string;missionId?:string;candidateId?:string;commitSha?:string;pullNumber?:number;
};

export function parseGitWebhookContext(eventName:string,payload:Json):GitWebhookContext{
  const repository=nestedText(payload,"repository","full_name");
  if(!repository)throw new Error("GitHub webhook payload is missing repository.full_name");
  let branch:string|undefined,commitSha:string|undefined,pullNumber:number|undefined;
  if(eventName==="push"){
    branch=text(payload.ref)?.replace(/^refs\/heads\//,"");commitSha=sha(payload.after);
  }else if(eventName==="pull_request"){
    branch=nestedText(payload,"pull_request","head","ref");commitSha=sha(nestedText(payload,"pull_request","head","sha"));pullNumber=positiveInteger(payload.number);
  }else if(eventName==="check_run"){
    branch=nestedText(payload,"check_run","check_suite","head_branch");
    commitSha=sha(nestedText(payload,"check_run","head_sha")??nestedText(payload,"check_run","check_suite","head_sha"));
  }else if(eventName==="check_suite"){
    branch=nestedText(payload,"check_suite","head_branch");commitSha=sha(nestedText(payload,"check_suite","head_sha"));
  }
  const parts=branch?.split("/");
  const canonical=parts?.length===3&&parts[0]==="evolve"&&Boolean(parts[1])&&Boolean(parts[2]);
  return{event:eventName,repository,branch,...(canonical?{missionId:parts![1],candidateId:parts![2]}:{}),commitSha,pullNumber};
}

function missionRepository(project:EvolveProject){
  const git=project.targetConnection.git;return git?(git.owner+"/"+git.repo).toLowerCase():undefined;
}
function fail(message:string):never{const error=new Error(message);(error as Error&{code?:string}).code="GIT_WEBHOOK_BINDING_MISMATCH";throw error;}

export function buildGitWebhookEvent(args:{mission:EvolveProject;context:GitWebhookContext;deliveryFingerprint?:string;at?:string}){
  const {mission,context}=args;
  if(!context.missionId||!context.candidateId||!context.branch)fail("GitHub webhook does not identify a canonical Evolution Mission/Candidate branch");
  if(context.missionId!==mission.id)fail("GitHub webhook Mission binding mismatch");
  if(mission.targetConnection.adapter!=="git"||mission.targetConnection.status!=="connected")fail("Mission is not connected to a Git Target");
  if(missionRepository(mission)!==context.repository.toLowerCase())fail("GitHub webhook repository does not match Mission Git Target");
  const champion=mission.searchChampion?.candidate;
  const acceptance=mission.searchChampion?.artifactAcceptance??mission.artifactAcceptance;
  if(!champion||champion.id!==context.candidateId)fail("GitHub webhook Candidate does not match Mission Search Champion");
  if(acceptance.status!=="passed"||(acceptance.candidateId&&acceptance.candidateId!==champion.id))fail("GitHub webhook Candidate is not the Gate F accepted Champion");
  const canonicalBranch=evolutionGitBranch(mission.id,champion.id);
  if(context.branch!==canonicalBranch)fail("GitHub webhook branch "+context.branch+" does not match canonical accepted branch "+canonicalBranch);
  if(!mission.release.sourceGitRepository||!mission.release.sourceGitBranch||!mission.release.sourceGitCommitSha){
    fail("Mission has no persisted Accepted Git writeback identity for webhook binding");
  }
  if(mission.release.sourceGitRepository.toLowerCase()!==context.repository.toLowerCase())fail("GitHub webhook repository does not match persisted accepted writeback");
  if(mission.release.sourceGitBranch!==context.branch)fail("GitHub webhook branch does not match persisted accepted writeback");
  if(!context.commitSha)fail("GitHub webhook is missing exact head commit for persisted writeback binding");
  if(mission.release.sourceGitCommitSha!==context.commitSha){
    fail("GitHub webhook commit "+context.commitSha+" does not match persisted accepted commit "+mission.release.sourceGitCommitSha);
  }
  if(context.event==="pull_request"&&mission.release.sourceGitPullNumber){
    if(!context.pullNumber)fail("GitHub pull_request webhook is missing PR number");
    if(mission.release.sourceGitPullNumber!==context.pullNumber){
      fail("GitHub webhook PR #"+context.pullNumber+" does not match persisted PR #"+mission.release.sourceGitPullNumber);
    }
  }
  const eventId=args.deliveryFingerprint?"evt-github-"+args.deliveryFingerprint.slice(0,48):undefined;
  return createEvolutionEvent({
    id:eventId,missionId:mission.id,type:"ActionCompleted",source:"github-webhook",at:args.at,
    payload:{
      event:context.event,repository:context.repository,branch:context.branch,candidateId:champion.id,
      commitSha:context.commitSha,pullNumber:context.pullNumber,
      binding:"persisted-accepted-writeback",
    },
  });
}
