import {afterEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import type {EvolveProject} from "../schemas";

const capabilities={
  available:true,
  fullAuto:false,
  durable:true,
  serverAi:true,
  closure:{
    codeReady:true,
    offlineFullAuto:true,
    onlineFullAuto:false,
    configBlocked:[],
    externalCapabilityBlocked:[{capability:"online-release-orchestration",reason:"autonomous-live-release-not-integrated"}],
  },
  serverNativeActions:["run-campaign","campaign-artifact-acceptance","package","distill","next-queue"],
  conditionalActions:["run-campaign","revalidate"],
  blockedActions:[],
  migrationPendingActions:[],
  pendingActions:["run-campaign","revalidate"],
};

afterEach(()=>vi.unstubAllGlobals());

describe("server workflow routing",()=>{
  it("uses Durable AutoPilot for offline missions without claiming global fullAuto",async()=>{
    vi.resetModules();
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    const {shouldUseServerAutoPilot}=await import("./server-workflow-client");
    const offline={...demoProject,targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"}} as EvolveProject;
    expect(await shouldUseServerAutoPilot(offline)).toBe(true);
  });

  it("keeps online missions out of Durable AutoPilot until autonomous Release is integrated",async()=>{
    vi.resetModules();
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(capabilities),{status:200,headers:{"Content-Type":"application/json"}})));
    const {shouldUseServerAutoPilot}=await import("./server-workflow-client");
    const online={...demoProject,targetConnection:{adapter:"http",connectionId:"production",status:"connected",label:"Production"}} as EvolveProject;
    expect(await shouldUseServerAutoPilot(online)).toBe(false);
  });
});
