import {afterEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import type {EvolveProject} from "../schemas";
import {checkPublicReadiness,getServerEvolutionWorkflowStatus,getServerWorkflowCapabilities,requiresIsolatedHtmlServerExecution,shouldUseServerAutoPilot,startServerEvolutionWorkflow} from "./server-workflow-client";

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
    connectorExperimentIds:["workflow-main"],
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

  it("reads the unauthenticated public readiness snapshot for degraded control-plane diagnostics",async()=>{
    const snapshot={
      probeMode:"passive-config",
      checkedAt:"2026-09-22T10:00:00.000Z",workflow:{durable:true,cronConfigured:true},
      blockers:[],
      dataPlane:{configured:true,secureCredential:true,database:true,storage:true,coreTables:true,credentialMode:"secret",urlPresent:true,secretPresent:true,publishablePresent:false,artifactBucketPresent:true,configValid:true,issueFields:[]},
      sourceParse:true,artifactRenderer:true,serverAi:true,serverAiConnectionStorageConfigured:false,sandbox:true,sandboxPolicy:true,browser:true,
      release:{read:true,write:true},git:{configured:true,webhook:true},
      capability:{database:true,semantic:true,sharing:true},evidence:{database:true,signing:true,immutable:true,export:true},
      outcome:{database:true,ingestion:true,analysis:true,telemetry:true},
      security:{configured:true,browserAccessConfigured:true,enforced:true,productionSafe:true,vault:true,approvalStore:true,memberDirectory:true},
      connectors:{configured:true,fullLifecycle:true},targetProxy:{run:true,release:true,observe:true},
    };
    const fetchMock=vi.fn(async(url:RequestInfo|URL)=>{
      expect(String(url)).toBe("/api/evolution/public-readiness");
      return new Response(JSON.stringify(snapshot),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    expect(await checkPublicReadiness()).toEqual(snapshot);
  });

  it("distinguishes unsafe executable HTML from ordinary Markdown and reference-only HTML",()=>{
    const base={...demoProject,
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
    } as EvolveProject;
    expect(requiresIsolatedHtmlServerExecution(base)).toBe(false);
    const htmlSource={...demoProject.sourceArtifacts[0]!,extension:"html",mimeType:"text/html"};
    const mixed={...base,sourceArtifacts:[htmlSource,...demoProject.sourceArtifacts.slice(1)]};
    expect(requiresIsolatedHtmlServerExecution(mixed)).toBe(true);
    expect(requiresIsolatedHtmlServerExecution({
      ...base,sourceArtifacts:[{...htmlSource,role:"reference"}],
    })).toBe(false);
    expect(requiresIsolatedHtmlServerExecution({
      ...mixed,targetConnection:{...base.targetConnection,adapter:"git"},
    })).toBe(false);
  });

  it("shows the operator the authorized HTML Sandbox remediation returned by the server",async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({
      statusMessage:"HTML Sandbox 尚未实际就绪，进化任务尚未启动",
      data:{code:"HTML_SANDBOX_NOT_READY",
        action:"为此 Vercel 项目完成 Sandbox 授权并重新检测"},
    }),{status:503,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(startServerEvolutionWorkflow("html-mission",{
      idempotencyKey:"original-request",
    })).rejects.toThrow(
      /HTML Sandbox 尚未实际就绪.*处理方式：为此 Vercel 项目完成 Sandbox 授权并重新检测/);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/evolution/start",
      expect.objectContaining({method:"POST"}),
    );
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

  it("passes a stable operation key through a durable Workflow start retry",async()=>{
    const fetchMock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      expect(JSON.parse(String(init?.body))).toEqual({missionId:"mission-1",idempotencyKey:"autopilot:revision-1"});
      return new Response(JSON.stringify({
        missionId:"mission-1",controlJobId:"job-1",runId:"run-1",status:"queued",reused:true,
      }),{status:200});
    });
    vi.stubGlobal("fetch",fetchMock);
    expect((await startServerEvolutionWorkflow("mission-1",{idempotencyKey:"autopilot:revision-1"})).reused).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("validates the durable Workflow status response",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL)=>{
      expect(String(url)).toBe("/api/evolution/status?runId=run-1");
      return new Response(JSON.stringify({workflow:{exists:true,status:"running"},events:[]}),{status:200});
    }));
    expect(await getServerEvolutionWorkflowStatus({runId:" run-1 "}))
      .toEqual({workflow:{exists:true,status:"running"},events:[]});
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
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact Target"},
      releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",connectionId:"http-prod",healthPath:"/"},
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
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact Target"},
      releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",connectionId:"http-prod",healthPath:"/"},
      gates:demoProject.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate),
    } as EvolveProject;
    expect(await shouldUseServerAutoPilot(httpMission)).toBe(false);
  });

  it("keeps an HTTP validation Runner offline unless an explicit HTTP Release target is connected",async()=>{
    const offlineRunner={
      ...demoProject,
      targetConnection:{adapter:"http",connectionId:"runner-gateway",status:"connected",label:"HTTP Runner"},
      releaseTarget:undefined,
    } as EvolveProject;
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(offlineRunner)).toBe(capabilities.closure.offlineFullAuto);
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

  it("hands a Connector Mission to Durable AutoPilot when the exact connector supports the experiment lifecycle",async()=>{
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

    const otherOnly={...capabilities,backend:{...capabilities.backend,connectorExperimentIds:["other"],connectorFullLifecycleIds:["other"]}};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(otherOnly),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(connectorMission)).toBe(false);
  });

  it("allows experiment-only Connector Missions without claiming Connector production Release support",async()=>{
    const connectorMission={
      ...demoProject,
      sourceArtifacts:[],
      targetConnection:{
        adapter:"connector",connectionId:"connector-workflow-main",status:"connected",label:"Workflow Connector",
        connector:{connectorId:"workflow-main",targetId:"workflow-42"},
      },
      releaseTarget:undefined,
    } as EvolveProject;
    const experimentOnly={
      ...capabilities,
      backend:{...capabilities.backend,connectorExperimentIds:["workflow-main"],connectorFullLifecycleIds:[]},
    };
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(experimentOnly),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(connectorMission)).toBe(true);
    connectorMission.releaseTarget={provider:"connector",mode:"preview-promote",status:"connected",label:"Connector Release",healthPath:"/"};
    connectorMission.gates=connectorMission.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate);
    expect(await shouldUseServerAutoPilot(connectorMission)).toBe(false);
  });

  it("keeps an online Connector Release mission provider-specific after Release Ready approval",async()=>{
    const connectorRelease={
      ...demoProject,
      targetConnection:{
        adapter:"connector",connectionId:"connector-workflow-main",status:"connected",label:"Workflow Connector",
        connector:{connectorId:"workflow-main",targetId:"workflow-42"},
      },
      releaseTarget:{provider:"connector",mode:"preview-promote",status:"connected",label:"Connector Release",healthPath:"/"},
      gates:demoProject.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate),
    } as EvolveProject;
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(connectorRelease)).toBe(true);

    const wrongConnector={...capabilities,backend:{...capabilities.backend,connectorFullLifecycleIds:["other"]}};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(wrongConnector),{status:200,headers:{"Content-Type":"application/json"}})));
    await getServerWorkflowCapabilities(true);
    expect(await shouldUseServerAutoPilot(connectorRelease)).toBe(false);
  });
  it("rejects Workflow start and status receipts for another Mission or Job",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      missionId:"mission-other",controlJobId:"job-1",runId:"run-1",status:"queued",
    }),{status:200})));
    await expect(startServerEvolutionWorkflow("mission-expected"))
      .rejects.toThrow("Workflow start Mission identity mismatch");
    const at="2026-09-24T00:00:00.000Z";
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      job:{schemaVersion:"job-v1",id:"job-other",type:"mission-action",status:"running",
        label:"Run",idempotencyKey:"run:1",createdAt:at,updatedAt:at},events:[],
    }),{status:200})));
    await expect(getServerEvolutionWorkflowStatus({jobId:"job-expected"}))
      .rejects.toThrow("Workflow status Job identity mismatch");
  });
});
