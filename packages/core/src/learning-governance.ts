import type {EvolveProject,Lesson,NextQueueItem} from "@evolution/contracts";
import {
  productionOutcomeFreshness,
  productionOutcomeTrend,
} from "./release-outcome";
import {projectHasOnlineReleaseTarget} from "./release-target";

export type LearningGovernanceResult={
  lessons:Lesson[];
  nextQueue:NextQueueItem[];
  changed:boolean;
  reason:string;
};

function sameReleaseBinding(lesson:Lesson,project:EvolveProject){
  const currentCandidateId=project.release.candidateId??project.searchChampion?.candidate?.id;
  const currentDeploymentId=project.release.deploymentId;
  return (!lesson.governance?.candidateId||!currentCandidateId||lesson.governance.candidateId===currentCandidateId)
    &&(!lesson.governance?.deploymentId||!currentDeploymentId||lesson.governance.deploymentId===currentDeploymentId);
}

function needsRedistillFromLessons(project:EvolveProject,lessons:Lesson[],now:number){
  const freshness=productionOutcomeFreshness(project,{now});
  const trend=productionOutcomeTrend(project,{now});
  if(project.release.status!=="promoted"||freshness.status!=="fresh"||trend.status!=="stable-healthy")return false;
  const bound=lessons.filter((lesson)=>lesson.governance&&sameReleaseBinding(lesson,project));
  if(bound.some((lesson)=>lesson.status==="verified-skill"&&lesson.governance?.status==="active"))return false;
  const degraded=bound.filter((lesson)=>lesson.governance?.status==="degraded"||lesson.governance?.status==="revoked");
  if(!degraded.length)return false;
  const latestDegraded=Math.max(...degraded.map((lesson)=>Date.parse(lesson.governance!.updatedAt)||0));
  const latestPending=Math.max(0,...bound.filter((lesson)=>lesson.governance?.status==="pending").map((lesson)=>Date.parse(lesson.governance!.updatedAt)||0));
  return latestPending<latestDegraded;
}

export function projectNeedsProductionLearningRedistill(
  project:EvolveProject,
  options?:{now?:number},
){
  return projectHasOnlineReleaseTarget(project)
    &&needsRedistillFromLessons(project,project.lessons??[],options?.now??Date.now());
}

function queueItem(project:EvolveProject,reason:string,priority:"P0"|"P1"):NextQueueItem{
  const candidateId=project.release.candidateId??project.searchChampion?.candidate?.id??"unknown";
  const deploymentId=project.release.deploymentId??"unknown";
  return {
    id:`production-outcome:${candidateId}:${deploymentId}`,
    title:"复核 Production Outcome 并恢复稳定线上证据",
    reason,
    priority,
    source:"production-outcome",
    suggestedMetrics:["production health","observation trend","rollback state"],
  };
}

function upsertQueue(queue:NextQueueItem[],item:NextQueueItem){
  const index=queue.findIndex((existing)=>existing.id===item.id||(
    existing.source==="production-outcome"
    &&existing.title===item.title
  ));
  if(index<0)return [item,...queue];
  const next=[...queue];
  next[index]={...next[index]!,...item};
  return next;
}

export function governProductionLessons(
  project:EvolveProject,
  options?:{now?:number;at?:string},
):LearningGovernanceResult{
  if(!projectHasOnlineReleaseTarget(project)){
    return {lessons:project.lessons??[],nextQueue:project.nextQueue??[],changed:false,reason:"Offline project has no production learning governance."};
  }
  const now=options?.now??Date.now();
  const at=options?.at??new Date(now).toISOString();
  const freshness=productionOutcomeFreshness(project,{now});
  const trend=productionOutcomeTrend(project,{now});
  const rolledBack=project.release.status==="rolled-back";
  const currentCandidateId=project.release.candidateId??project.searchChampion?.candidate?.id;
  const currentDeploymentId=project.release.deploymentId;
  let changed=false;
  const lessons=(project.lessons??[]).map((lesson)=>{
    if(!lesson.governance){
      if(lesson.status!=="verified-skill")return lesson;
      changed=true;
      return {
        ...lesson,
        status:"lesson" as const,
        reusable:false,
        governance:{
          status:"degraded" as const,
          reason:"历史 Verified Skill 缺少 exact Candidate / Deployment 的 Production governance 绑定；降级为 Lesson，等待重新线上验证。",
          candidateId:currentCandidateId,
          deploymentId:currentDeploymentId,
          outcomeTrend:trend.status,
          observedAt:project.release.observedAt,
          updatedAt:at,
        },
      };
    }
    const sameCandidate=!lesson.governance.candidateId||!currentCandidateId||lesson.governance.candidateId===currentCandidateId;
    const sameDeployment=!lesson.governance.deploymentId||!currentDeploymentId||lesson.governance.deploymentId===currentDeploymentId;
    if(!sameCandidate||!sameDeployment){
      if(lesson.status!=="verified-skill"&&lesson.governance.status==="revoked")return lesson;
      changed=true;
      return {
        ...lesson,
        status:lesson.status==="verified-skill"?"lesson" as const:lesson.status,
        reusable:false,
        governance:{
          ...lesson.governance,
          status:"revoked" as const,
          reason:"该经验绑定的 Production Candidate / Deployment 已不再是当前线上版本，取消 Verified Skill 复用资格。",
          outcomeTrend:trend.status,
          observedAt:project.release.observedAt,
          updatedAt:at,
        },
      };
    }
    if(rolledBack){
      if(lesson.status!=="verified-skill"&&lesson.governance.status==="revoked")return lesson;
      changed=true;
      return {
        ...lesson,
        status:lesson.status==="verified-skill"?"lesson" as const:lesson.status,
        reusable:false,
        governance:{
          ...lesson.governance,
          status:"revoked" as const,
          reason:"当前 Candidate 已 Rollback；撤销该 Verified Skill 的线上复用资格，保留为 Lesson 等待重新验证。",
          outcomeTrend:trend.status,
          observedAt:project.release.observedAt,
          updatedAt:at,
        },
      };
    }
    if(project.release.status==="promoted"&&trend.status==="stable-healthy"&&freshness.status==="fresh"){
      const active=lesson.status==="verified-skill";
      const previouslyInvalid=lesson.governance.status==="degraded"||lesson.governance.status==="revoked";
      const nextGovernance={
        ...lesson.governance,
        status:active?"active" as const:previouslyInvalid?lesson.governance.status:"pending" as const,
        reason:active
          ?trend.reason
          :previouslyInvalid
            ?`Production 已恢复稳定，但该 Skill 需要重新 Distill / 验证后才能恢复复用资格：${trend.reason}`
            :lesson.governance.reason,
        outcomeTrend:trend.status,
        observedAt:project.release.observedAt,
        updatedAt:at,
      };
      if(JSON.stringify(nextGovernance)!==JSON.stringify(lesson.governance))changed=true;
      return {...lesson,governance:nextGovernance};
    }
    if(lesson.status==="verified-skill"||lesson.governance.status==="active"){
      changed=true;
      const severe=trend.status==="degrading"||trend.status==="flapping";
      return {
        ...lesson,
        status:"lesson" as const,
        reusable:false,
        governance:{
          ...lesson.governance,
          status:severe?"revoked" as const:"degraded" as const,
          reason:`Production Outcome 不再满足 Verified Skill 门槛：${trend.reason}`,
          outcomeTrend:trend.status,
          observedAt:project.release.observedAt,
          updatedAt:at,
        },
      };
    }
    return lesson;
  });

  let nextQueue=project.nextQueue??[];
  const needsRedistill=needsRedistillFromLessons(project,lessons,now);
  const needsFollowup=rolledBack
    ||freshness.status!=="fresh"
    ||trend.status==="degrading"
    ||trend.status==="flapping"
    ||trend.status==="healthy-insufficient"
    ||trend.status==="unknown"
    ||needsRedistill;
  if(needsFollowup){
    const priority=rolledBack||trend.status==="degrading"||trend.status==="flapping"?"P0":"P1";
    const reason=rolledBack
      ?"当前 Production 已 Rollback；重新验证线上稳定性与触发原因后，再恢复 Skill 复用资格。"
      :needsRedistill
        ?"Production Outcome 已恢复稳定，但此前降级/撤销的 Skill 必须重新 Distill 并获得新证据后才能恢复复用资格。"
      :`${freshness.reason} ${trend.reason}`;
    const updatedQueue=upsertQueue(nextQueue,queueItem(project,reason,priority));
    if(updatedQueue!==nextQueue||JSON.stringify(updatedQueue)!==JSON.stringify(nextQueue))changed=true;
    nextQueue=updatedQueue;
  }else{
    const followupId=`production-outcome:${currentCandidateId??"unknown"}:${currentDeploymentId??"unknown"}`;
    const cleared=nextQueue.filter((item)=>item.id!==followupId);
    if(cleared.length!==nextQueue.length)changed=true;
    nextQueue=cleared;
  }
  return {
    lessons,
    nextQueue,
    changed,
    reason:needsFollowup
      ?"Production Outcome governance updated lessons and follow-up queue."
      :"Production Outcome remains stable; learning assets stay active.",
  };
}

export function attachLessonGovernance(
  project:EvolveProject,
  lesson:Lesson,
  options?:{at?:string},
):Lesson{
  if(!projectHasOnlineReleaseTarget(project))return lesson;
  const at=options?.at??new Date().toISOString();
  const trend=productionOutcomeTrend(project,{now:Date.parse(at)});
  return {
    ...lesson,
    governance:{
      status:lesson.status==="verified-skill"&&project.release.status==="promoted"&&trend.status==="stable-healthy"?"active":"pending",
      reason:lesson.status==="verified-skill"&&project.release.status==="promoted"&&trend.status==="stable-healthy"
        ?trend.reason
        :project.release.status==="rolled-back"
          ?"当前 Release 已 Rollback，不能把本轮方法升级为 Verified Skill。"
          :`等待稳定 Production Outcome：${trend.reason}`,
      candidateId:project.release.candidateId??project.searchChampion?.candidate?.id,
      deploymentId:project.release.deploymentId,
      outcomeTrend:trend.status,
      observedAt:project.release.observedAt,
      updatedAt:at,
    },
  };
}

export function applyProductionLearningGovernance(
  project:EvolveProject,
  options?:{now?:number;at?:string},
):EvolveProject{
  const governed=governProductionLessons(project,options);
  if(!governed.changed)return project;
  return {
    ...project,
    lessons:governed.lessons,
    nextQueue:governed.nextQueue,
    updatedAt:options?.at??project.updatedAt,
  };
}

export function mergeGovernedNextQueue(
  existing:NextQueueItem[],
  generated:NextQueueItem[],
){
  const governed=existing.filter((item)=>item.source==="production-outcome");
  const merged=[...governed,...generated];
  const seen=new Set<string>();
  return merged.filter((item)=>{
    const key=item.id||`${item.source}:${item.title}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
