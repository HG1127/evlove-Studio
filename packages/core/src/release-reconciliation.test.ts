import {describe,expect,it} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult,VercelReleaseObservation} from "@evolution/contracts";
import {nextDurableReleaseAction} from "./release-orchestration";
import {reconcileHttpReleaseObservation,reconcileReleaseObservation} from "./release-reconciliation";

function fixture(){
  const candidate={id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now"}]} as unknown as Candidate;
  const project={
    id:"mission",version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],updatedAt:"old",stage:"release",candidates:[candidate],experimentRun:{winnerId:"C1"},searchChampion:{candidate},
    gates:[{id:"release-ready",status:"approved"}],
    campaign:{status:"paused",stopReason:"[server-release-provider-pending] promote result unknown",schedule:{enabled:false}},
    releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"},
    release:{
      status:"shadow",candidateId:"C1",deploymentId:"dpl_candidate",stableDeploymentId:"dpl_stable",
      trafficPercent:0,healthy:true,evidenceMode:"live",observationStatus:"healthy",kpis:[],history:[],
      recovery:{status:"pending",action:"promote",reason:"provider timeout",at:"2026-09-20T15:00:00Z"},
    },
  } as unknown as EvolveProject;
  return {project,candidate};
}

function observation(productionId:string,productionReady=true,boundReady=true):VercelReleaseObservation{
  return {
    provider:"vercel",checkedAt:"2026-09-20T15:05:00Z",
    productionDeployment:{id:productionId,url:"https://prod.vercel.app",state:"READY",target:"production"},
    boundDeployment:{id:"dpl_candidate",url:"https://candidate.vercel.app",state:"READY",target:"preview"},
    productionHealth:{ready:productionReady,url:"https://prod.vercel.app",checkedAt:"2026-09-20T15:05:00Z",latencyMs:20,checks:[{path:"/",ok:productionReady,status:productionReady?200:500,latencyMs:20}],message:"production"},
    boundHealth:{ready:boundReady,url:"https://candidate.vercel.app",checkedAt:"2026-09-20T15:05:00Z",latencyMs:10,checks:[{path:"/",ok:boundReady,status:boundReady?200:500,latencyMs:10}],message:"bound"},
    errors:[],
  };
}

function httpFixture(){
  const x=fixture();
  x.project.targetConnection={adapter:"http",connectionId:"http-release",status:"connected",label:"HTTP Target"};
  x.project.releaseTarget={provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",healthPath:"/"};
  x.project.release={...x.project.release,deploymentId:"http-candidate",stableDeploymentId:"http-stable"};
  return x;
}

function httpObserved(action:"shadow"|"promote"|"rollback",at="2026-09-22T01:10:00Z",deploymentId=action==="rollback"?"http-stable":"http-candidate"):ReleaseAdapterResult{
  return{
    ok:true,trafficPercent:action==="promote"?100:0,note:`observed ${action}`,healthy:true,kpis:[],evidenceMode:"live",
    effectiveAction:action,observationStatus:"healthy",deploymentId,stableDeploymentId:"http-stable",
    artifactHashes:action==="rollback"?undefined:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    environment:action==="shadow"?"preview":"production",observedAt:at,sampleSize:2,windowMinutes:1,
  };
}

describe("release reconciliation",()=>{
  it("settles an uncertain HTTP promote from a read-only live receipt",()=>{
    const x=httpFixture();
    const result=reconcileHttpReleaseObservation({project:x.project,candidate:x.candidate,observation:httpObserved("promote")});
    expect(result.disposition).toBe("terminal-live-decision");
    expect(result.project.release).toMatchObject({
      status:"promoted",deploymentId:"http-candidate",environment:"production",healthy:true,observationStatus:"healthy",
    });
    expect(result.project.release.observations?.at(-1)?.source).toBe("reconcile");
    expect(result.project.version).toBe("V13");
  });

  it("does not re-apply a promoted HTTP Candidate when a later read-only observation refreshes Production health",()=>{
    const x=httpFixture();
    (x.candidate as unknown as {patches:string[]}).patches=["patch-new"];
    x.project.candidates=[x.candidate];
    const first=reconcileHttpReleaseObservation({project:x.project,candidate:x.candidate,observation:httpObserved("promote","2026-09-22T01:10:00Z")});
    expect(first.project.version).toBe("V13");
    expect(first.project.appliedPatches).toHaveLength(1);
    const second=reconcileHttpReleaseObservation({project:first.project,candidate:x.candidate,observation:httpObserved("promote","2026-09-22T01:20:00Z")});
    expect(second.project.version).toBe("V13");
    expect(second.project.appliedPatches).toHaveLength(1);
    expect(second.project.release.observations?.filter((item)=>item.source==="reconcile")).toHaveLength(2);
  });

  it("fails closed when HTTP Observe claims another Candidate deployment",()=>{
    const x=httpFixture();
    const result=reconcileHttpReleaseObservation({
      project:x.project,candidate:x.candidate,observation:httpObserved("promote","2026-09-22T01:10:00Z","http-other"),
    });
    expect(result.disposition).toBe("manual-check");
    expect(result.project.release.recovery?.status).toBe("manual-check");
    expect(result.reason).toContain("deploymentId");
  });

  it("fails closed when HTTP Observe returns an artifact hash for another Candidate snapshot",()=>{
    const x=httpFixture();
    const observed={...httpObserved("promote"),artifactHashes:[{sourceArtifactId:"source",contentHash:"wrong"}]};
    const result=reconcileHttpReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("manual-check");
    expect(result.reason).toContain("Artifact Hash");
  });

  it("keeps an explicit rollback recovery intent when Observe proves the rollback did not take effect",()=>{
    const x=httpFixture();
    x.project.release={
      ...x.project.release,
      status:"promoted",
      trafficPercent:100,
      environment:"production",
      recovery:{status:"pending",action:"rollback",reason:"rollback response lost",at:"2026-09-22T01:00:00Z"},
    };
    const result=reconcileHttpReleaseObservation({project:x.project,candidate:x.candidate,observation:httpObserved("promote")});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.recovery).toMatchObject({status:"reconciled",action:"rollback"});
    expect(nextDurableReleaseAction(result.project)).toBe("rollback");
  });

  it("recovers a Promote that succeeded after the process lost its receipt",()=>{
    const x=fixture();
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_candidate")});
    expect(result.disposition).toBe("terminal-live-decision");
    expect(result.project.release.status).toBe("promoted");
    expect(result.project.release.recovery?.status).toBe("reconciled");
    expect(result.project.release.observedAt).toBe("2026-09-20T15:05:00Z");
    expect(result.project.campaign.status).toBe("running");
    expect(result.project.version).toBe("V13");
    expect(result.project.release.observations?.at(-1)).toMatchObject({source:"reconcile",action:"reconcile",deploymentId:"dpl_candidate",environment:"production",latencyMs:20});
  });

  it("turns a recovered unhealthy Production into a safe rollback continuation",()=>{
    const x=fixture();
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_candidate",false)});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.status).toBe("promoted");
    expect(result.project.release.healthy).toBe(false);
    expect(result.project.version).toBe("V13");
  });

  it("refreshes an already promoted Mission without incrementing the project version twice",()=>{
    const x=fixture();
    x.project.version="V13";
    x.project.release={...x.project.release,status:"promoted",healthy:true,evidenceMode:"live",observationStatus:"healthy",recovery:undefined};
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_candidate",true)});
    expect(result.project.version).toBe("V13");
  });

  it("recovers a Rollback that reached the known stable deployment",()=>{
    const x=fixture();
    x.project.release={...x.project.release,status:"promoted",recovery:{status:"pending",action:"rollback",reason:"timeout",at:"2026-09-20T15:00:00Z"}};
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_stable")});
    expect(result.disposition).toBe("terminal-live-decision");
    expect(result.project.release.status).toBe("rolled-back");
    expect(result.project.release.deploymentId).toBe("dpl_stable");
    expect(result.project.release.observations?.at(-1)).toMatchObject({deploymentId:"dpl_stable",environment:"production"});
    expect(result.project.release.observations?.at(-1)?.artifactHashes).toBeUndefined();
  });

  it("refreshes a rolled-back terminal outcome without misclassifying stable as the Candidate",()=>{
    const x=fixture();
    x.project.release={...x.project.release,status:"rolled-back",deploymentId:"dpl_stable",healthy:true,evidenceMode:"live",observationStatus:"healthy",environment:"production",observedAt:"2026-09-20T14:00:00Z",recovery:undefined};
    const observed=observation("dpl_stable");
    observed.boundDeployment={id:"dpl_stable",url:"https://prod.vercel.app",state:"READY",target:"production"};
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("terminal-live-decision");
    expect(result.project.release.status).toBe("rolled-back");
    expect(result.project.release.observedAt).toBe("2026-09-20T15:05:00Z");
  });

  it("continues the requested Rollback when Production still points at the Candidate",()=>{
    const x=fixture();
    x.project.release={...x.project.release,status:"promoted",recovery:{status:"pending",action:"rollback",reason:"timeout",at:"2026-09-20T15:00:00Z"}};
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_candidate",true)});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.status).toBe("promoted");
    expect(result.project.release.recovery).toMatchObject({status:"reconciled",action:"rollback"});
    expect(nextDurableReleaseAction(result.project)).toBe("rollback");
  });

  it("recovers Preview health while Production remains on the known stable deployment",()=>{
    const x=fixture();
    x.project.release={...x.project.release,status:"idle",recovery:{status:"pending",action:"shadow",reason:"timeout",at:"2026-09-20T15:00:00Z"}};
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_stable")});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.status).toBe("shadow");
    expect(result.project.release.healthy).toBe(true);
  });

  it("recovers an active 20% Rolling Release and resumes from the exact canary stage",()=>{
    const x=fixture();
    x.project.releaseTarget={...x.project.releaseTarget!,mode:"progressive"};
    x.project.release={
      ...x.project.release,
      status:"canary-5",
      trafficPercent:5,
      recovery:{status:"pending",action:"canary-20",reason:"provider timeout",at:"2026-09-20T15:00:00Z"},
    };
    const observed=observation("dpl_stable",true,true);
    observed.rollingRelease={
      active:true,
      enabled:true,
      advancementType:"manual-approval",
      candidateDeploymentId:"dpl_candidate",
      stableDeploymentId:"dpl_stable",
      currentStageIndex:1,
      currentPercentage:20,
      stages:[{targetPercentage:5},{targetPercentage:20},{targetPercentage:50},{targetPercentage:100}],
    };
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release).toMatchObject({
      status:"canary-20",
      trafficPercent:20,
      healthy:true,
      environment:"production-canary",
      stableDeploymentId:"dpl_stable",
    });
    expect(nextDurableReleaseAction(result.project)).toBe("canary-50");
  });

  it("recovers an unhealthy active canary and resumes directly into rollback",()=>{
    const x=fixture();
    x.project.releaseTarget={...x.project.releaseTarget!,mode:"progressive"};
    x.project.release={
      ...x.project.release,
      status:"canary-5",
      trafficPercent:5,
      recovery:{status:"pending",action:"canary-20",reason:"provider timeout",at:"2026-09-20T15:00:00Z"},
    };
    const observed=observation("dpl_stable",true,false);
    observed.rollingRelease={
      active:true,
      enabled:true,
      advancementType:"manual-approval",
      candidateDeploymentId:"dpl_candidate",
      stableDeploymentId:"dpl_stable",
      currentStageIndex:1,
      currentPercentage:20,
      stages:[{targetPercentage:5},{targetPercentage:20},{targetPercentage:50},{targetPercentage:100}],
    };
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.status).toBe("canary-20");
    expect(result.project.release.healthy).toBe(false);
    expect(nextDurableReleaseAction(result.project)).toBe("rollback");
  });

  it("captures the current Production as stable baseline when a read-only Preview receipt was lost",()=>{
    const x=fixture();
    x.project.release={...x.project.release,status:"idle",stableDeploymentId:undefined,recovery:{status:"pending",action:"shadow",reason:"timeout",at:"2026-09-20T15:00:00Z"}};
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_current_prod")});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.status).toBe("shadow");
    expect(result.project.release.stableDeploymentId).toBe("dpl_current_prod");
  });

  it("requires manual review if a read-only Preview recovery finds the Candidate already in Production",()=>{
    const x=fixture();
    x.project.release={...x.project.release,status:"idle",recovery:{status:"pending",action:"shadow",reason:"timeout",at:"2026-09-20T15:00:00Z"}};
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_candidate")});
    expect(result.disposition).toBe("manual-check");
    expect(result.reason).toContain("不会切换 Production");
  });

  it("keeps waiting when the exact Git commit has not produced a Vercel Preview yet",()=>{
    const x=fixture();
    x.project.release={
      ...x.project.release,
      status:"idle",
      deploymentId:undefined,
      stableDeploymentId:undefined,
      sourceGitCommitSha:"sha-exact",
      recovery:undefined,
    };
    const observed=observation("dpl_current");
    observed.boundDeployment=undefined;
    observed.boundHealth=undefined;
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.deploymentId).toBeUndefined();
    expect(result.project.release.recovery).toMatchObject({status:"pending",action:"shadow"});
    expect(result.reason).toContain("sha-exact");
  });

  it("auto-binds the unique exact-SHA Preview while it is still BUILDING but does not run Health yet",()=>{
    const x=fixture();
    x.project.release={
      ...x.project.release,
      status:"idle",
      deploymentId:undefined,
      stableDeploymentId:undefined,
      sourceGitCommitSha:"sha-exact",
      recovery:undefined,
    };
    const observed=observation("dpl_current");
    observed.boundDeployment={
      id:"dpl_candidate",
      url:"https://candidate.vercel.app",
      state:"BUILDING",
      target:"preview",
      meta:{githubCommitSha:"sha-exact"},
    };
    observed.boundHealth=undefined;
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release.deploymentId).toBe("dpl_candidate");
    expect(result.project.release.recovery).toMatchObject({status:"pending",action:"shadow"});
    expect(result.reason).toContain("BUILDING");
  });

  it("auto-binds a READY exact-SHA Preview, captures current Production as stable, and settles Preview Health",()=>{
    const x=fixture();
    x.project.release={
      ...x.project.release,
      status:"idle",
      deploymentId:undefined,
      stableDeploymentId:undefined,
      sourceGitCommitSha:"sha-exact",
      recovery:undefined,
    };
    const observed=observation("dpl_current",true,true);
    observed.boundDeployment={
      id:"dpl_candidate",
      url:"https://candidate.vercel.app",
      state:"READY",
      target:"preview",
      meta:{githubCommitSha:"sha-exact"},
    };
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("safe-to-resume");
    expect(result.project.release).toMatchObject({
      status:"shadow",
      candidateId:"C1",
      deploymentId:"dpl_candidate",
      stableDeploymentId:"dpl_current",
      healthy:true,
      evidenceMode:"live",
      environment:"preview",
    });
  });

  it("fails closed when the discovered Preview Git SHA differs from the Mission exact commit",()=>{
    const x=fixture();
    x.project.release={
      ...x.project.release,
      status:"idle",
      deploymentId:undefined,
      stableDeploymentId:undefined,
      sourceGitCommitSha:"sha-exact",
      recovery:undefined,
    };
    const observed=observation("dpl_current");
    observed.boundDeployment={
      id:"dpl_candidate",
      url:"https://candidate.vercel.app",
      state:"READY",
      target:"preview",
      meta:{githubCommitSha:"sha-wrong"},
    };
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observed});
    expect(result.disposition).toBe("manual-check");
    expect(result.project.release.recovery?.status).toBe("manual-check");
    expect(result.reason).toContain("sha-wrong");
    expect(result.reason).toContain("sha-exact");
  });

  it("fails closed when Production points to an unknown deployment",()=>{
    const x=fixture();
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_unknown")});
    expect(result.disposition).toBe("manual-check");
    expect(result.project.release.status).toBe("shadow");
    expect(result.project.release.recovery?.status).toBe("manual-check");
    expect(result.reason).toContain("既不是");
  });
});
