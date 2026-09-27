import { describe, expect, it } from "vitest";
import type { EvolveProject } from "@evolution/contracts";
import { resolveServerBaselineCodebaseBinding } from "./server-baseline";

function codebaseProject():EvolveProject{
  return {
    id:"code-mission",
    version:"V1",
    sourceArtifacts:[{
      id:"source-zip",name:"repo.zip",role:"target",artifactKind:"codebase",mimeType:"application/zip",
      size:100,extension:"zip",inputMode:"file",parseStatus:"ready",textContent:"",textExcerpt:"",
      structure:[],warnings:[],createdAt:"2026-09-20T13:00:00.000Z",
      artifactDescriptor:{family:"codebase",adapterId:"codebase-zip",preservationMode:"preserve-package",capabilities:{parse:true,mutate:true,materialize:true,roundtrip:true}},
    }],
  } as unknown as EvolveProject;
}

function acceptedChampion(project:EvolveProject,frozen:boolean){
  const candidate={
    id:"candidate-s1",name:"S1",change:"code change",status:"winner" as const,artifactBuildStatus:"ready" as const,
    artifactSnapshots:[{
      id:"snapshot-s1",sourceArtifactId:"source-zip",name:"repo.zip",mimeType:"application/zip",
      content:'{"kind":"codebase-patch","files":[]}',contentHash:"candidate-hash",buildMode:"ai-full" as const,
      notes:[],createdAt:"2026-09-20T13:10:00.000Z",
      ...(frozen?{frozenArtifact:{
        sourceArtifactId:"source-zip",snapshotHash:"candidate-hash",blobId:"champion-blob",
        name:"repo.zip",mimeType:"application/zip",sha256:"sha256-champion",size:123,
        verifiedAt:"2026-09-20T13:10:00.000Z",checks:["zip"],limitations:[],
      }}:{}),
    }],
    patches:[],addressesAdvice:[],riskLevel:"low" as const,risks:[],accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS" as const,recommended:true,notes:[],
  };
  const evaluation={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS" as const,averageCost:0,averageLatencyMs:1,notes:[],failures:[]};
  project.searchChampion={
    id:"champion-s1",versionLabel:"S1",round:1,score:90,candidate,evaluation,
    validation:{id:"validation-s1",status:"completed",candidateId:candidate.id,recommendation:"release",evaluation,checks:[],runs:[],baselineRuns:[]},
    artifactAcceptance:{id:"accept-s1",status:"passed",candidateId:candidate.id,overallScore:90,coverageScore:90,integrityScore:90,pairwiseScore:90,hardGatePass:true,results:[],attempts:0,maxRepairAttempts:3,summary:"accepted"},
    patches:[],parentVersionId:"V1",reason:"accepted",selectedAt:"2026-09-20T13:10:00.000Z",
  };
}

describe("server baseline codebase binding",()=>{
  it("uses the original source blob only when no accepted champion snapshot exists",()=>{
    const project=codebaseProject();
    expect(resolveServerBaselineCodebaseBinding(project)).toMatchObject({blobId:"source-zip",candidateId:undefined});
  });

  it("reads the source ZIP from storageRef when its metadata ID differs",()=>{
    const project=codebaseProject();
    project.sourceArtifacts[0]!.storageRef="raw-zip";
    expect(resolveServerBaselineCodebaseBinding(project)).toMatchObject({blobId:"raw-zip",candidateId:undefined});
  });

  it("keeps the accepted champion's frozen ZIP ahead of the source storageRef",()=>{
    const project=codebaseProject();
    project.sourceArtifacts[0]!.storageRef="raw-zip";
    acceptedChampion(project,true);
    expect(resolveServerBaselineCodebaseBinding(project)).toMatchObject({blobId:"champion-blob",candidateId:"candidate-s1"});
  });
  it("refuses to fall back to the source ZIP when the accepted champion is not frozen",()=>{
    const project=codebaseProject();
    acceptedChampion(project,false);
    const binding=resolveServerBaselineCodebaseBinding(project);
    expect(binding.blobId).toBeUndefined();
    expect(binding.candidateId).toBe("candidate-s1");
    expect(binding.reason).toContain("不能回退原 Source ZIP");
  });

  it("binds Sandbox execution to the accepted champion frozen ZIP when available",()=>{
    const project=codebaseProject();
    acceptedChampion(project,true);
    expect(resolveServerBaselineCodebaseBinding(project)).toMatchObject({
      blobId:"champion-blob",
      candidateId:"candidate-s1",
      sha256:"sha256-champion",
    });
  });
});
