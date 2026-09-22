// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject} from "@evolution/contracts";
import {executeServerReleaseProvider} from "./server-release-orchestration";

const previousUrl=process.env.EVOLUTION_TARGET_RELEASE_URL;
const previousToken=process.env.EVOLUTION_TARGET_BEARER_TOKEN;

afterEach(()=>{
  if(previousUrl===undefined)delete process.env.EVOLUTION_TARGET_RELEASE_URL;
  else process.env.EVOLUTION_TARGET_RELEASE_URL=previousUrl;
  if(previousToken===undefined)delete process.env.EVOLUTION_TARGET_BEARER_TOKEN;
  else process.env.EVOLUTION_TARGET_BEARER_TOKEN=previousToken;
  vi.unstubAllGlobals();
});

describe("server HTTP release composition",()=>{
  it("sends the exact Candidate to the server-only HTTP release endpoint without inventing a deployment id",async()=>{
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://release.internal/action";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="release-secret";
    const candidate={
      id:"C1",name:"candidate",change:"x",patches:[],artifactSnapshots:[{
        id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now",
      }],
    } as unknown as Candidate;
    const project={
      id:"http-release-mission",
      targetConnection:{adapter:"artifact",connectionId:"artifact-runtime",status:"connected",label:"Artifact Target"},
      releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",connectionId:"release-http",healthPath:"/"},
      experimentRun:{winnerId:"C1"},
      candidates:[candidate],
      searchChampion:{candidate},
      release:{status:"idle",candidateId:"C1",trafficPercent:0,kpis:[],evidenceMode:"none",history:[]},
    } as unknown as EvolveProject;
    const fetchMock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      expect(String(input)).toBe("https://release.internal/action");
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer release-secret");
      const body=JSON.parse(String(init?.body)) as {connectionId:string;candidate:Candidate;action:string};
      expect(body.connectionId).toBe("release-http");
      expect(body.candidate.id).toBe("C1");
      expect(body.action).toBe("shadow");
      expect(String(init?.body)).not.toContain("release-secret");
      return new Response(JSON.stringify({
        ok:true,trafficPercent:0,note:"shadow healthy",healthy:true,kpis:[],evidenceMode:"live",
        effectiveAction:"shadow",observationStatus:"healthy",deploymentId:"http-candidate",stableDeploymentId:"http-stable",
        artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
        environment:"preview",observedAt:"2026-09-22T01:00:00Z",sampleSize:1,windowMinutes:1,
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);

    const receipt=await executeServerReleaseProvider(project,{
      action:"shadow",
      deploymentId:undefined,
      stableDeploymentId:"http-stable",
      healthPath:"/",
      artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    });
    expect(receipt.deploymentId).toBe("http-candidate");
    expect(receipt.evidenceMode).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
