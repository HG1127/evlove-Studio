import {describe,expect,it} from "vitest";
import type {Candidate,EvolveProject,VercelReleaseObservation} from "@evolution/contracts";
import {runServerReleaseReconciliation} from "./server-release-reconciliation";

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

describe("server release reconciliation",()=>{
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
