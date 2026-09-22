// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject} from "@evolution/contracts";
import {executeServerReleaseProvider} from "./server-release-orchestration";
import {runServerMissionReleaseReconciliation} from "./server-release-reconciliation";

const previousConnectors=process.env.EVOLUTION_CONNECTORS_JSON;

afterEach(()=>{
  if(previousConnectors===undefined)delete process.env.EVOLUTION_CONNECTORS_JSON;
  else process.env.EVOLUTION_CONNECTORS_JSON=previousConnectors;
  vi.unstubAllGlobals();
});

function manifest(){
  return JSON.stringify([{
    id:"workflow-main",label:"Workflow",targetType:"workflow",baseUrl:"https://connector.test",
    paths:{deploy:"/deploy",observe:"/observe",rollback:"/rollback",read:"/read",snapshot:"/snapshot",mutate:"/mutate",validate:"/validate"},
  }]);
}

function fixture(){
  const candidate={
    id:"C1",name:"candidate",change:"x",patches:[],
    artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"workflow.json",mimeType:"application/json",content:"{}",contentHash:"hash-c1",createdAt:"now"}],
    connectorBinding:{
      connectorId:"workflow-main",targetId:"workflow-42",baseVersionRef:"v42",versionRef:"v43",
      artifactFingerprint:"fp-c1",snapshotRef:"snap43",evidenceRefs:[],observedAt:"now",
    },
  } as unknown as Candidate;
  const project={
    id:"connector-release-composition",version:"V12",currentVersionId:"V12",appliedPatches:[],versions:[],
    targetConnection:{
      adapter:"connector",connectionId:"connector",status:"connected",label:"Connector",
      connector:{connectorId:"workflow-main",targetId:"workflow-42"},
      connectorSnapshot:{connectorId:"workflow-main",targetId:"workflow-42",versionRef:"v42",snapshotRef:"snap42",artifactId:"source",observedAt:"now"},
    },
    releaseTarget:{provider:"connector",mode:"preview-promote",status:"connected",label:"Connector Release",healthPath:"/"},
    experimentRun:{winnerId:"C1"},candidates:[candidate],searchChampion:{candidate},
    campaign:{status:"running",schedule:{enabled:false}},
    release:{status:"idle",candidateId:"C1",trafficPercent:0,kpis:[],evidenceMode:"none",history:[]},
  } as unknown as EvolveProject;
  return{project,candidate};
}

function providerBody(action:"shadow"|"promote"){
  return{
    ok:true,versionRef:"v43",deploymentRef:"preview-v43",evidenceRefs:["release-evidence"],
    observedAt:"2026-09-22T04:30:00Z",note:"observed",
    output:{
      effectiveAction:action,trafficPercent:action==="promote"?100:0,healthy:true,
      observationStatus:"healthy",environment:action==="shadow"?"preview":"production",
      stableDeploymentRef:"prod-v42",latencyMs:20,sampleSize:2,windowMinutes:1,
    },
  };
}

describe("Server Connector release composition",()=>{
  it("dispatches the durable release write to the Connector deploy endpoint with exact Candidate version provenance",async()=>{
    process.env.EVOLUTION_CONNECTORS_JSON=manifest();
    const {project}=fixture();
    const fetchMock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      expect(String(input)).toBe("https://connector.test/deploy");
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(body).toMatchObject({targetId:"workflow-42",expectedVersionRef:"v43"});
      expect(body.payload).toMatchObject({releaseAction:"shadow",candidateVersionRef:"v43",stableVersionRef:"v42"});
      return new Response(JSON.stringify(providerBody("shadow")),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const receipt=await executeServerReleaseProvider(project,{
      action:"shadow",deploymentId:undefined,stableDeploymentId:undefined,healthPath:"/",
      artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
    });
    expect(receipt).toMatchObject({effectiveAction:"shadow",deploymentId:"preview-v43",stableDeploymentId:"prod-v42",evidenceMode:"live"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reconciles through read-only Connector observe without replaying deploy",async()=>{
    process.env.EVOLUTION_CONNECTORS_JSON=manifest();
    const {project}=fixture();
    project.release={
      ...project.release,status:"shadow",deploymentId:"preview-v43",stableDeploymentId:"prod-v42",
      healthy:true,evidenceMode:"live",observationStatus:"healthy",environment:"preview",
      recovery:{status:"pending",action:"promote",reason:"deploy response lost",at:"2026-09-22T04:20:00Z"},
    };
    const fetchMock=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
      expect(String(input)).toBe("https://connector.test/observe");
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(body).toMatchObject({targetId:"workflow-42"});
      expect(body.payload).toMatchObject({recoveryAction:"promote",candidateVersionRef:"v43",stableVersionRef:"v42"});
      return new Response(JSON.stringify(providerBody("promote")),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const outcome=await runServerMissionReleaseReconciliation(project);
    expect(outcome.provider).toBe("connector");
    expect(outcome.disposition).toBe("terminal-live-decision");
    expect(outcome.project.release.status).toBe("promoted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every(([input])=>String(input).endsWith("/observe"))).toBe(true);
  });
});
