import {describe,expect,it} from "vitest";
import type {Candidate,EvolveProject,ReleaseAdapterResult,VercelReleaseObservation} from "@evolution/contracts";
import {runServerHttpReleaseReconciliation,runServerReleaseReconciliation} from "./server-release-reconciliation";

function fixture(){
  const candidate={id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now"}]} as unknown as Candidate;
  return {
    project:{
      id:"mission",version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],stage:"release",updatedAt:"old",candidates:[candidate],experimentRun:{winnerId:"C1"},searchChampion:{candidate},
      campaign:{status:"paused",stopReason:"[server-release-provider-pending] promote unknown",schedule:{enabled:false}},
      releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"},
      release:{status:"shadow",candidateId:"C1",deploymentId:"dpl_candidate",stableDeploymentId:"dpl_stable",trafficPercent:0,kpis:[],evidenceMode:"live",history:[],recovery:{status:"pending",action:"promote",reason:"unknown",at:"2026-09-20T15:00:00Z"}},
    } as unknown as EvolveProject,
    candidate,
  };
}

function observed(productionId:string):VercelReleaseObservation{
  return {
    provider:"vercel",checkedAt:"2026-09-20T15:05:00Z",
    productionDeployment:{id:productionId,url:"https://prod.vercel.app",state:"READY",target:"production"},
    boundDeployment:{id:"dpl_candidate",url:"https://candidate.vercel.app",state:"READY",target:"preview"},
    productionHealth:{ready:true,url:"https://prod.vercel.app",checkedAt:"now",latencyMs:1,checks:[{path:"/",ok:true,status:200,latencyMs:1}],message:"ok"},
    boundHealth:{ready:true,url:"https://candidate.vercel.app",checkedAt:"now",latencyMs:1,checks:[{path:"/",ok:true,status:200,latencyMs:1}],message:"ok"},
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

function httpObserved():ReleaseAdapterResult{
  return{
    ok:true,trafficPercent:100,note:"production observed",healthy:true,kpis:[],evidenceMode:"live",
    effectiveAction:"promote",observationStatus:"healthy",deploymentId:"http-candidate",stableDeploymentId:"http-stable",
    artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],environment:"production",
    observedAt:"2026-09-22T01:10:00Z",sampleSize:2,windowMinutes:1,
  };
}

describe("server release reconciliation",()=>{
  it("settles HTTP recovery from a read-only observe receipt without replaying the release write",async()=>{
    const x=httpFixture();
    const outcome=await runServerHttpReleaseReconciliation(x.project,{observe:async(args)=>{
      expect(args.deploymentId).toBe("http-candidate");
      expect(args.expectedArtifactHashes).toEqual([{sourceArtifactId:"source",contentHash:"hash-c1"}]);
      expect(args.recoveryAction).toBe("promote");
      return httpObserved();
    }});
    expect(outcome.control).toBe("continue");
    expect(outcome.disposition).toBe("terminal-live-decision");
    expect(outcome.project.release.status).toBe("promoted");
  });

  it("pauses for manual review when the HTTP observe endpoint itself is unavailable",async()=>{
    const x=httpFixture();
    const outcome=await runServerHttpReleaseReconciliation(x.project,{observe:async()=>{throw new Error("observe unavailable");}});
    expect(outcome.control).toBe("stop");
    expect(outcome.disposition).toBe("manual-check");
    expect(outcome.project.campaign.stopReason).toContain("server-release-manual-check");
    expect(outcome.reason).toContain("不会自动重放");
  });

  it("continues automatically when observation proves the terminal release decision",async()=>{
    const x=fixture();
    const outcome=await runServerReleaseReconciliation(x.project,{observe:async()=>observed("dpl_candidate")});
    expect(outcome.control).toBe("continue");
    expect(outcome.disposition).toBe("terminal-live-decision");
    expect(outcome.project.release.status).toBe("promoted");
  });

  it("pauses for human review when Production is unknown",async()=>{
    const x=fixture();
    const outcome=await runServerReleaseReconciliation(x.project,{observe:async()=>observed("dpl_other")});
    expect(outcome.control).toBe("stop");
    expect(outcome.disposition).toBe("manual-check");
    expect(outcome.project.campaign.stopReason).toContain("server-release-manual-check");
  });
});
