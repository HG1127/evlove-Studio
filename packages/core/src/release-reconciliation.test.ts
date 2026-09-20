import {describe,expect,it} from "vitest";
import type {Candidate,EvolveProject,VercelReleaseObservation} from "@evolution/contracts";
import {nextDurableReleaseAction} from "./release-orchestration";
import {reconcileReleaseObservation} from "./release-reconciliation";

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

describe("release reconciliation",()=>{
  it("recovers a Promote that succeeded after the process lost its receipt",()=>{
    const x=fixture();
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_candidate")});
    expect(result.disposition).toBe("terminal-live-decision");
    expect(result.project.release.status).toBe("promoted");
    expect(result.project.release.recovery?.status).toBe("reconciled");
    expect(result.project.release.observedAt).toBe("2026-09-20T15:05:00Z");
    expect(result.project.campaign.status).toBe("running");
    expect(result.project.version).toBe("V13");
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

  it("fails closed when Production points to an unknown deployment",()=>{
    const x=fixture();
    const result=reconcileReleaseObservation({project:x.project,candidate:x.candidate,observation:observation("dpl_unknown")});
    expect(result.disposition).toBe("manual-check");
    expect(result.project.release.status).toBe("shadow");
    expect(result.project.release.recovery?.status).toBe("manual-check");
    expect(result.reason).toContain("既不是");
  });
});
