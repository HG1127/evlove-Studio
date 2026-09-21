import {describe,expect,it} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult} from "@evolution/contracts";
import {applyReleaseResultToProject,nextDurableReleaseAction,projectHasLiveReleaseDecision} from "./index";

type ReleaseAction=NonNullable<ReleaseAdapterResult["effectiveAction"]>;

function fixture(){
  const candidate={id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now"}]} as unknown as Candidate;
  const project={
    version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],
    targetConnection:{adapter:"artifact"},
    releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"},
    experimentRun:{winnerId:"C1"},
    candidates:[candidate],
    searchChampion:{candidate},
    gates:[{id:"release-ready",status:"approved"}],
    campaign:{status:"running"},
    release:{status:"idle",candidateId:"C1",deploymentId:"dpl-preview",trafficPercent:0,kpis:[],evidenceMode:"none",history:[]},
  } as unknown as EvolveProject;
  return {project,candidate};
}

function receipt(action:ReleaseAction,healthy=true):ReleaseAdapterResult{
  const traffic=action==="canary-5"?5:action==="canary-20"?20:action==="canary-50"?50:action==="promote"?100:0;
  return {
    ok:healthy,
    trafficPercent:traffic,
    note:`${action} receipt`,
    healthy,
    kpis:[],
    evidenceMode:"live",
    effectiveAction:action,
    observationStatus:healthy?"healthy":"unhealthy",
    stableDeploymentId:"dpl-stable",
    deploymentId:action==="rollback"?"dpl-stable":"dpl-preview",
    artifactHashes:action==="rollback"?undefined:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    environment:action==="shadow"?"preview":action.startsWith("canary-")?"production-canary":"production",
    observedAt:"2026-09-20T15:00:00Z",
    latencyMs:12,
    sampleSize:1,
    windowMinutes:0.1,
  };
}

describe("durable release orchestration",()=>{
  it("advances only the explicitly bound Candidate deployment",()=>{
    const {project,candidate}=fixture();
    expect(nextDurableReleaseAction(project)).toBe("shadow");
    const preview=applyReleaseResultToProject({project,candidate,requestedAction:"shadow",result:receipt("shadow")});
    expect(preview.release.status).toBe("shadow");
    expect(nextDurableReleaseAction(preview)).toBe("promote");
    const promoted=applyReleaseResultToProject({project:preview,candidate,requestedAction:"promote",result:receipt("promote")});
    expect(projectHasLiveReleaseDecision(promoted)).toBe(true);
    expect(promoted.stage).toBe("learning");
    expect(promoted.release.observations).toHaveLength(2);
    expect(promoted.release.observations?.at(-1)).toMatchObject({source:"release-action",action:"promote",latencyMs:12,environment:"production"});
  });

  it("routes an unhealthy promoted deployment to rollback instead of learning",()=>{
    const {project,candidate}=fixture();
    const preview=applyReleaseResultToProject({project,candidate,requestedAction:"shadow",result:receipt("shadow")});
    const unhealthy=applyReleaseResultToProject({project:preview,candidate,requestedAction:"promote",result:receipt("promote",false)});
    expect(projectHasLiveReleaseDecision(unhealthy)).toBe(false);
    expect(nextDurableReleaseAction(unhealthy)).toBe("rollback");
    const rolledBack=applyReleaseResultToProject({project:unhealthy,candidate,requestedAction:"rollback",result:receipt("rollback")});
    expect(projectHasLiveReleaseDecision(rolledBack)).toBe(true);
  });

  it("advances a progressive release through 5/20/50 before full promote",()=>{
    const {project,candidate}=fixture();
    project.releaseTarget={...project.releaseTarget!,mode:"progressive"};
    const shadow=applyReleaseResultToProject({project,candidate,requestedAction:"shadow",result:receipt("shadow")});
    expect(nextDurableReleaseAction(shadow)).toBe("canary-5");
    const canary5=applyReleaseResultToProject({project:shadow,candidate,requestedAction:"canary-5",result:receipt("canary-5")});
    expect(canary5.release).toMatchObject({status:"canary-5",trafficPercent:5,environment:"production-canary"});
    expect(nextDurableReleaseAction(canary5)).toBe("canary-20");
    const canary20=applyReleaseResultToProject({project:canary5,candidate,requestedAction:"canary-20",result:receipt("canary-20")});
    expect(nextDurableReleaseAction(canary20)).toBe("canary-50");
    const canary50=applyReleaseResultToProject({project:canary20,candidate,requestedAction:"canary-50",result:receipt("canary-50")});
    expect(nextDurableReleaseAction(canary50)).toBe("promote");
    const promoted=applyReleaseResultToProject({project:canary50,candidate,requestedAction:"promote",result:receipt("promote")});
    expect(promoted.release.status).toBe("promoted");
    expect(promoted.release.trafficPercent).toBe(100);
    expect(projectHasLiveReleaseDecision(promoted)).toBe(true);
    expect(promoted.version).toBe("V13");
  });

  it("routes an unhealthy progressive canary to stable rollback without further rollout",()=>{
    const {project,candidate}=fixture();
    project.releaseTarget={...project.releaseTarget!,mode:"progressive"};
    const shadow=applyReleaseResultToProject({project,candidate,requestedAction:"shadow",result:receipt("shadow")});
    const canary5=applyReleaseResultToProject({
      project:shadow,candidate,requestedAction:"canary-5",result:receipt("canary-5",false),
    });
    expect(canary5.release.status).toBe("canary-5");
    expect(canary5.release.healthy).toBe(false);
    expect(nextDurableReleaseAction(canary5)).toBe("rollback");
  });

  it("treats ok=false as non-terminal even when the raw health probe was green",()=>{
    const {project,candidate}=fixture();
    const preview=applyReleaseResultToProject({project,candidate,requestedAction:"shadow",result:receipt("shadow")});
    const uncertain={...receipt("promote"),ok:false,healthy:true,observationStatus:"healthy" as const};
    const promoted=applyReleaseResultToProject({project:preview,candidate,requestedAction:"promote",result:uncertain});
    expect(promoted.release.healthy).toBe(false);
    expect(promoted.release.observationStatus).toBe("unhealthy");
    expect(projectHasLiveReleaseDecision(promoted)).toBe(false);
    expect(nextDurableReleaseAction(promoted)).toBe("rollback");
  });

  it("rejects a receipt for another artifact snapshot",()=>{
    const {project,candidate}=fixture();
    const bad={...receipt("shadow"),artifactHashes:[{sourceArtifactId:"source",contentHash:"wrong"}]};
    expect(()=>applyReleaseResultToProject({project,candidate,requestedAction:"shadow",result:bad})).toThrow(/Artifact Hash/);
  });

  it("rejects a provider action mismatch instead of guessing the release state",()=>{
    const {project,candidate}=fixture();
    const mismatched={...receipt("rollback"),effectiveAction:"rollback" as const};
    expect(()=>applyReleaseResultToProject({project,candidate,requestedAction:"promote",result:mismatched})).toThrow(/effectiveAction/);
  });

  it("is idempotent for the same persisted live receipt",()=>{
    const {project,candidate}=fixture();
    const previewReceipt=receipt("shadow");
    const once=applyReleaseResultToProject({project,candidate,requestedAction:"shadow",result:previewReceipt});
    const twice=applyReleaseResultToProject({project:once,candidate,requestedAction:"shadow",result:previewReceipt});
    expect(twice).toBe(once);
    expect(twice.release.history).toHaveLength(1);
    expect(twice.release.observations).toHaveLength(1);
  });
});
