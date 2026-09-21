import {afterEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import type {EvolveProject} from "../schemas";
import {getServerWorkflowCapabilities,shouldUseServerAutoPilot} from "./server-workflow-client";

const capabilities={
  available:true,
  fullAuto:false,
  durable:true,
  serverAi:true,
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
});
