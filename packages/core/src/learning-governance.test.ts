import {describe,expect,it} from "vitest";
import type {EvolveProject,Lesson} from "@evolution/contracts";
import {withMeasuredProductionGoal} from "@evolution/testkit";
import {
  appendReleaseObservation,
  applyProductionLearningGovernance,
  attachLessonGovernance,
  governProductionLessons,
  integrateDistilledLesson,
  mergeGovernedNextQueue,
  projectNeedsProductionLearningRedistill,
} from "./index";

function baseProject():EvolveProject{
  const observedAt="2026-09-20T15:00:00.000Z";
  return withMeasuredProductionGoal({
    id:"mission-learning",
    releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel"},
    targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
    release:{
      status:"promoted",candidateId:"C1",deploymentId:"dpl-c1",stableDeploymentId:"dpl-stable",
      trafficPercent:100,healthy:true,kpis:[],evidenceMode:"live",observationStatus:"healthy",
      environment:"production",observedAt,history:[],
      observations:[
        {id:"h1",at:"2026-09-20T14:59:00.000Z",source:"release-action",action:"promote",candidateId:"C1",deploymentId:"dpl-c1",evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"promote"},
        {id:"h2",at:observedAt,source:"reconcile",action:"reconcile",candidateId:"C1",deploymentId:"dpl-c1",evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"refresh"},
      ],
    },
    candidates:[{id:"C1",artifactSnapshots:[{id:"snap-c1",contentHash:"hash-c1"}]}],
    searchChampion:{candidate:{id:"C1"}},
    experimentRun:{winnerId:"C1"},
    validationRun:{id:"validation-c1"},
    lessons:[],
    nextQueue:[],
  } as unknown as EvolveProject);
}

function skill(project:EvolveProject):Lesson{
  return attachLessonGovernance(project,{
    id:"L1",title:"Skill",summary:"works",reusable:true,effect:"improved",limit:"production",
    trigger:["prod"],method:["do"],validatedOn:["production"],status:"verified-skill",
  },{at:"2026-09-20T15:00:00.000Z"});
}

describe("production learning governance",()=>{
  it("does not mint a Verified Skill from offline acceptance",()=>{
    const p=baseProject();p.releaseTarget={provider:"none",mode:"progressive",status:"not-configured",label:"offline",healthPath:"/"};
    const result=attachLessonGovernance(p,{id:"offline",title:"offline",summary:"useful",reusable:true,effect:"improved",limit:"offline",trigger:[],method:[],validatedOn:[],status:"verified-skill"});
    expect(result.status).toBe("lesson");
  });
  it("attaches active governance only when production evidence is stable healthy",()=>{
    const project=baseProject();
    const lesson=skill(project);
    expect(lesson.governance).toMatchObject({status:"active",candidateId:"C1",deploymentId:"dpl-c1",outcomeTrend:"stable-healthy"});
    expect(lesson.provenance).toMatchObject({
      missionId:"mission-learning",
      candidateId:"C1",
      deploymentId:"dpl-c1",
      validationRunId:"validation-c1",
      artifactSnapshotIds:["snap-c1"],
      artifactHashes:["hash-c1"],
      releaseEvidenceMode:"live",
    });
    expect(lesson.governance?.history?.map((entry)=>entry.status)).toEqual(["active"]);
  });

  it("downgrades legacy online verified skills that lack production governance binding",()=>{
    const project=baseProject();
    project.lessons=[{
      id:"legacy",title:"Legacy Skill",summary:"old",reusable:true,effect:"old",limit:"unknown",
      trigger:[],method:[],validatedOn:["production"],status:"verified-skill",
    }];
    const governed=governProductionLessons(project,{now:Date.parse("2026-09-20T15:01:00.000Z"),at:"2026-09-20T15:01:00.000Z"});
    expect(governed.lessons[0]).toMatchObject({status:"lesson",reusable:false,governance:{status:"degraded"}});
  });

  it("downgrades an active verified skill when production evidence becomes stale",()=>{
    const project=baseProject();
    project.lessons=[skill(project)];
    const governed=governProductionLessons(project,{now:Date.parse("2026-09-20T16:00:00.000Z"),at:"2026-09-20T16:00:00.000Z"});
    expect(governed.lessons[0]).toMatchObject({status:"lesson",reusable:false,governance:{status:"degraded",outcomeTrend:"stale"}});
    expect(governed.lessons[0]?.governance?.history?.map((entry)=>entry.status)).toEqual(["active","degraded"]);
    expect(governed.nextQueue[0]).toMatchObject({priority:"P1",source:"production-outcome"});
  });

  it("supersedes degraded knowledge when a fresh verified skill is re-distilled on the same production binding",()=>{
    const project=baseProject();
    const previous=skill(project);
    project.lessons=[{
      ...previous,
      status:"lesson",
      reusable:false,
      governance:{...previous.governance!,status:"degraded",updatedAt:"2026-09-20T14:58:00.000Z"},
    }];
    const integrated=integrateDistilledLesson(project,{
      id:"L2",title:"Recovered Skill",summary:"revalidated",reusable:true,effect:"healthy",limit:"production",
      trigger:["prod"],method:["repeat"],validatedOn:["production"],status:"verified-skill",
    },{at:"2026-09-20T15:02:00.000Z"});
    expect(integrated.lesson).toMatchObject({
      id:"L2",
      status:"verified-skill",
      governance:{status:"active"},
      provenance:{missionId:"mission-learning",supersedesLessonIds:["L1"]},
    });
    const old=integrated.lessons.find((lesson)=>lesson.id==="L1");
    expect(old).toMatchObject({
      status:"lesson",
      reusable:false,
      governance:{status:"superseded",supersededByLessonId:"L2"},
    });
    expect(old?.governance?.history?.at(-1)?.status).toBe("superseded");
  });

  it("revokes a skill when the production candidate/deployment is replaced",()=>{
    const project=baseProject();
    project.lessons=[skill(project)];
    project.release={...project.release,candidateId:"C2",deploymentId:"dpl-c2"};
    const governed=governProductionLessons(project,{now:Date.parse("2026-09-20T15:01:00.000Z"),at:"2026-09-20T15:01:00.000Z"});
    expect(governed.lessons[0]).toMatchObject({status:"lesson",reusable:false,governance:{status:"revoked"}});
    expect(governed.lessons[0]?.governance?.reason).toContain("不再是当前线上版本");
  });

  it("revokes skill reuse and creates one P0 follow-up for flapping production",()=>{
    const project=baseProject();
    project.lessons=[skill(project)];
    project.release.observedAt="2026-09-20T15:03:00.000Z";
    project.release.observations=[
      {id:"h1",at:"2026-09-20T15:00:00.000Z",source:"reconcile",action:"reconcile",candidateId:"C1",deploymentId:"dpl-c1",evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"h"},
      {id:"u1",at:"2026-09-20T15:01:00.000Z",source:"reconcile",action:"reconcile",candidateId:"C1",deploymentId:"dpl-c1",evidenceMode:"live",environment:"production",healthy:false,observationStatus:"unhealthy",reason:"u"},
      {id:"h2",at:"2026-09-20T15:03:00.000Z",source:"reconcile",action:"reconcile",candidateId:"C1",deploymentId:"dpl-c1",evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"h"},
    ];
    const once=applyProductionLearningGovernance(project,{now:Date.parse("2026-09-20T15:04:00.000Z"),at:"2026-09-20T15:04:00.000Z"});
    expect(once.lessons[0]).toMatchObject({status:"lesson",reusable:false,governance:{status:"revoked",outcomeTrend:"flapping"}});
    expect(once.nextQueue.filter((item)=>item.source==="production-outcome")).toHaveLength(1);
    const twice=applyProductionLearningGovernance(once,{now:Date.parse("2026-09-20T15:05:00.000Z"),at:"2026-09-20T15:05:00.000Z"});
    expect(twice.nextQueue.filter((item)=>item.source==="production-outcome")).toHaveLength(1);
  });

  it("revokes a skill after rollback even when stable production is healthy",()=>{
    const project=baseProject();
    project.lessons=[skill(project)];
    project.release={...project.release,status:"rolled-back",deploymentId:"dpl-stable",observedAt:"2026-09-20T15:02:00.000Z"};
    const governed=governProductionLessons(project,{now:Date.parse("2026-09-20T15:03:00.000Z"),at:"2026-09-20T15:03:00.000Z"});
    expect(governed.lessons[0]).toMatchObject({status:"lesson",reusable:false,governance:{status:"revoked"}});
    expect(governed.nextQueue[0]).toMatchObject({priority:"P0",source:"production-outcome"});
  });

  it("never attaches active verified-skill governance to a rolled-back release",()=>{
    const project=baseProject();
    project.release={...project.release,status:"rolled-back",deploymentId:"dpl-stable"};
    const lesson=skill(project);
    expect(lesson.governance).toMatchObject({status:"pending"});
    expect(lesson.governance?.reason).toContain("Rollback");
  });

  it("clears the matching production follow-up after production becomes stable again",()=>{
    const project=baseProject();
    project.nextQueue=[{
      id:"production-outcome:C1:dpl-c1",title:"复核 Production Outcome 并恢复稳定线上证据",reason:"old",priority:"P1",source:"production-outcome",suggestedMetrics:[],
    }];
    const governed=governProductionLessons(project,{now:Date.parse("2026-09-20T15:01:00.000Z"),at:"2026-09-20T15:01:00.000Z"});
    expect(governed.nextQueue).toEqual([]);
  });

  it("requests one re-distill after a degraded skill recovers to stable production evidence",()=>{
    const project=baseProject();
    const lesson=skill(project);
    project.lessons=[{...lesson,status:"lesson",reusable:false,governance:{...lesson.governance!,status:"degraded",updatedAt:"2026-09-20T14:58:00.000Z"}}];
    const governed=applyProductionLearningGovernance(project,{now:Date.parse("2026-09-20T15:01:00.000Z"),at:"2026-09-20T15:01:00.000Z"});
    expect(governed.lessons[0]?.governance?.status).toBe("degraded");
    expect(governed.nextQueue[0]).toMatchObject({source:"production-outcome",priority:"P1"});
    expect(projectNeedsProductionLearningRedistill(governed,{now:Date.parse("2026-09-20T15:01:00.000Z")})).toBe(true);

    governed.lessons.unshift({
      id:"retry",title:"Retry Lesson",summary:"not enough",reusable:false,effect:"unknown",limit:"production",
      trigger:[],method:[],validatedOn:["production"],status:"lesson",
      governance:{
        status:"pending",reason:"re-distill attempted",candidateId:"C1",deploymentId:"dpl-c1",
        outcomeTrend:"stable-healthy",observedAt:"2026-09-20T15:00:00.000Z",updatedAt:"2026-09-20T15:02:00.000Z",
        history:[],
      },
    });
    expect(projectNeedsProductionLearningRedistill(governed,{now:Date.parse("2026-09-20T15:02:00.000Z")})).toBe(false);
  });

  it("preserves governance follow-ups when AI regenerates Next Queue",()=>{
    const existing=[{id:"production-outcome:C1:dpl",title:"Prod",reason:"bad",priority:"P0" as const,source:"production-outcome",suggestedMetrics:[]}];
    const generated=[{id:"ai-1",title:"AI",reason:"next",priority:"P1" as const,source:"lesson",suggestedMetrics:[]}];
    expect(mergeGovernedNextQueue(existing,generated).map((item)=>item.id)).toEqual(["production-outcome:C1:dpl","ai-1"]);
  });

  it("keeps release observation retention compatible with governance refreshes",()=>{
    const project=baseProject();
    project.release.observations=appendReleaseObservation(project.release.observations,{
      source:"reconcile",action:"reconcile",at:"2026-09-20T15:01:00.000Z",candidateId:"C1",deploymentId:"dpl-c1",
      evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"new",
    });
    expect(project.release.observations?.length).toBeGreaterThanOrEqual(2);
  });
});
