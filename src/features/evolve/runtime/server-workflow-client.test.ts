import {afterEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import type {EvolveProject} from "../schemas";
import {getServerWorkflowCapabilities,shouldUseServerAutoPilot,startServerEvolutionWorkflow} from "./server-workflow-client";

const capabilities={
  available:true,
  fullAuto:false,
  durable:true,
  serverAi:true,
  backend:{
    vercelReleaseConfigured:true,
    targetReleaseConfigured:true,
    targetObserveConfigured:true,
    gitTargetConfigured:true,
    connectorFullLifecycleIds:["workflow-main"],
  },
  closure:{
    codeReady:true,
    offlineFullAuto:true,
    onlineFullAuto:false,
    releaseOrchestrationReady:true,
    onlinePostApprovalAuto:true,
    configBlocked:[],
    externalCapabilityBlocked:[
      {capability:"online-release-authorization",reason:"human-release-ready-approval-required"},
    ],
  },
  serverNativeActions:["run-campaign","campaign-artifact-acceptance","run-release","package","distill","next-queue"],
  conditionalActions:["run-campaign","revalidate","run-release"],
  blockedActions:[],
  migrationPendingActions:[],
  pendingActions:[],
};

afterEach(()=>vi.unstubAllGlobals());

describe("server workflow routing",()=>{
  it("uses Durable AutoPilot for offline missions without claiming global fullAuto",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    const offline={...demoProject,targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"}} as EvolveProject;
    expect(await shouldUseServerAutoPilot(offline)).toBe(true);
  });

  it("passes scheduledFor through the durable workflow start request",async()=>{
    const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(url)).toContain("/api/evolution/start");
      expect(JSON.parse(String(init?.body))).toEqual({missionId:"mission-1",scheduledFor:"2026-09-22T01:00:00.000Z"});
      return new Response(JSON.stringify({
        missionId:"mission-1",
        controlJobId:"job-1",
        runId:"run-1",
        status:"queued",
        scheduledFor:"2026-09-22T01:00:00.000Z",
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await startServerEvolutionWorkflow("mission-1",{scheduledFor:"2026-09-22T01:00:00.000Z"});
    expect(result.scheduledFor).toBe("2026-09-22T01:00:00.000Z");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps online missions out until Release Ready is approved, then enables post-approval Durable AutoPilot",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    const online={
      ...demoProject,
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
      releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"},
      gates:demoProject.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"ready" as const}:gate),
    } as EvolveProject;
    expect(await shouldUseServerAutoPilot(online)).toBe(false);
    online.gates=online.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate);
    expect(await shouldUseServerAutoPilot(online)).toBe(true);
    online.releaseTarget={...online.releaseTarget!,mode:"progressive"};
    expect(await shouldUseServerAutoPilot(online)).toBe(true);
  });

  it("hands an approved HTTP Release mission to Durable AutoPilot only when HTTP write and observe are both configured",async()=>{
    const httpCapabilities={
      ...capabilities,
      backend:{...capabilities.backend,vercelReleaseConfigured:false,targetReleaseConfigured:true,targetObserveConfigured:true},
    };
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(httpCapabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    const online={
      ...demoProject,
      targetConnection:{adapter:"http",connectionId:"http-prod",status:"connected",label:"HTTP Target"},
      releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",healthPath:"/"},
      gates:demoProject.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate),
    } as EvolveProject;
    expect(await shouldUseServerAutoPilot(online)).toBe(true);

    const missingObserve={
      ...httpCapabilities,
      backend:{...httpCapabilities.backend,targetObserveConfigured:false},
    };
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(missingObserve),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(online)).toBe(false);
  });

  it("does not mistake a configured Vercel provider for HTTP mission support",async()=>{
    const vercelOnly={
      ...capabilities,
      backend:{...capabilities.backend,vercelReleaseConfigured:true,targetReleaseConfigured:false,targetObserveConfigured:false},
    };
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(vercelOnly),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    const httpMission={
      ...demoProject,
      targetConnection:{adapter:"http",connectionId:"http-prod",status:"connected",label:"HTTP Target"},
      releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",healthPath:"/"},
      gates:demoProject.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate),
    } as EvolveProject;
    expect(await shouldUseServerAutoPilot(httpMission)).toBe(false);
  });

  it("hands a Git repository Mission to Durable AutoPilot only when the server Git Target is configured",async()=>{
    const gitMission={
      ...demoProject,
      sourceArtifacts:[],
      targetConnection:{
        adapter:"git",connectionId:"git-acme-app",status:"connected",label:"GitHub",
        git:{provider:"github",owner:"acme",repo:"app",baseBranch:"main"},
      },
      releaseTarget:undefined,
    } as EvolveProject;
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(gitMission)).toBe(true);

    const missingGit={
      ...capabilities,
      backend:{...capabilities.backend,gitTargetConfigured:false},
    };
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(missingGit),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(gitMission)).toBe(false);
  });

  it("hands a Connector Mission to Durable AutoPilot only for the exact full-lifecycle connector id",async()=>{
    const connectorMission={
      ...demoProject,
      sourceArtifacts:[],
      targetConnection:{
        adapter:"connector",connectionId:"connector-workflow-main",status:"connected",label:"Workflow Connector",
        connector:{connectorId:"workflow-main",targetId:"workflow-42"},
      },
      releaseTarget:undefined,
    } as EvolveProject;
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(connectorMission)).toBe(true);

    const otherOnly={...capabilities,backend:{...capabilities.backend,connectorFullLifecycleIds:["other"]}};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(otherOnly),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(connectorMission)).toBe(false);
  });
});
