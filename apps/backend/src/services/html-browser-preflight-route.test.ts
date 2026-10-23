// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";

const mocks=vi.hoisted(()=>({
  missionGet:vi.fn(),
  preflight:vi.fn(),
  createJob:vi.fn(),
  lookup:vi.fn(),
  activeJobs:vi.fn(),
  start:vi.fn(),
  permission:vi.fn(),
}));
const recovery=vi.hoisted(()=>({serverWait:vi.fn()}));
vi.mock("@evolution/harness",async(importOriginal)=>({
  ...await importOriginal<typeof import("@evolution/harness")>(),
  serverExperimentRecoveryWait:recovery.serverWait,
}));
vi.mock("./html-browser-preflight",()=>({assertServerHtmlBrowserExecutionReady:mocks.preflight}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./production-runtime",()=>({
  getServerProductionRuntime:()=>({missions:{get:mocks.missionGet}}),
  createServerJobIdempotentReceipt:mocks.createJob,
  getServerJobByIdempotencyKey:mocks.lookup,
  listServerActiveMissionCampaignJobs:mocks.activeJobs,
  bindServerJobWorkflowRun:vi.fn(),
  isBenignJobBookkeepingConflict:vi.fn(()=>false),
  JobStateConflictError:class extends Error{
    constructor(public jobId:string,public reason:string,public current?:object){super(reason);}
  },
  MissionRevisionConflictError:class extends Error{},
}));
vi.mock("./workflow-run-control",()=>({
  cancelWorkflowRunById:vi.fn(),
  workflowRunIdForJob:vi.fn(()=>"wrun-reused"),
}));
vi.mock("workflow/api",()=>({start:mocks.start}));
vi.mock("../../../../../workflows/evolution-mission",()=>({evolutionMissionWorkflow:vi.fn()}));

import startRoute from "../../server/api/evolution/start.post";
import sandboxHealthRoute from "../../server/api/evolution/sandbox-health.get";
import browserHealthRoute from "../../server/api/evolution/browser-health.get";

const sandboxProbe=vi.hoisted(()=>({basic:vi.fn(),browser:vi.fn()}));
vi.mock("@evolution/adapters/sandbox",()=>({
  checkVercelSandboxHealth:sandboxProbe.basic,
  checkVercelSandboxBrowserHealth:sandboxProbe.browser,
}));

const mission=(extension:string)=>({
  id:"audit-html-start",name:"Isolated HTML audit",sourceArtifacts:[{
    // Mirror a genuine Source-backed mission; an undefined Target adapter is invalid.

    id:"source",role:"target",extension,artifactKind:"document",mimeType:extension==="html"?"text/html":"text/markdown",
  }],
  targetConnection:{adapter:"artifact",connectionId:"audit-source",status:"connected",label:"HTML Artifact Runtime"},
  campaign:{status:"idle",schedule:{enabled:false}},
});
function post(idempotencyKey?:string){
  return mockEvent(new Request("http://localhost/api/evolution/start",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({missionId:"audit-html-start",...(idempotencyKey?{idempotencyKey}:{})}),
  }));
}
function get(url:string){
  return mockEvent(new Request(url,{method:"GET"}));
}
beforeEach(()=>{
  for(const mock of Object.values(mocks))mock.mockReset();
  recovery.serverWait.mockReset();
  sandboxProbe.basic.mockReset();
  sandboxProbe.browser.mockReset();
  mocks.permission.mockResolvedValue(undefined);
  mocks.activeJobs.mockResolvedValue([]);
});

describe("Workflow start executes real HTML preflight BEFORE durable Job creation",()=>{
  it("fails closed on missing Vercel Browser authorization, without creating or starting a Job",async()=>{
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.preflight.mockRejectedValue(Object.assign(new Error("Sandbox not authorized"),{
      status:503,data:{code:"HTML_SANDBOX_NOT_READY"},
    }));
    await expect(startRoute(post())).rejects.toMatchObject({
      status:503,data:{code:"HTML_SANDBOX_NOT_READY"},
    });
    expect(mocks.preflight).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id:"audit-html-start",
    }));
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("returns an existing HTML Workflow receipt even after Sandbox credentials become unavailable",async()=>{
    mocks.missionGet.mockResolvedValue({
      ...mission("html"),targetConnection:{adapter:"artifact"},
    });
    mocks.lookup.mockResolvedValue({
      id:"existing-control",missionId:"audit-html-start",
      type:"campaign",status:"running",outputRef:"wrun-original",
    });
    mocks.preflight.mockRejectedValue(new Error("Sandbox temporarily unlicensed"));
    const receipt=await startRoute(post("same-html-request"));
    expect(receipt).toMatchObject({
      missionId:"audit-html-start",controlJobId:"existing-control",
      runId:"wrun-reused",reused:true,
    });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith(
      "workflow-control:audit-html-start:same-html-request");
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("does not start another HTML Workflow when the original idempotent Job failed",async()=>{
    mocks.missionGet.mockResolvedValue({
      ...mission("html"),targetConnection:{adapter:"artifact"},
    });
    mocks.lookup.mockResolvedValue({
      id:"old-failed",missionId:"audit-html-start",
      type:"campaign",status:"failed",outputRef:"wrun-old",
    });
    const receipt=await startRoute(post("failed-original"));
    expect(receipt).toMatchObject({
      controlJobId:"old-failed",error:expect.stringContaining("没有可复用"),
    });
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("rejects a corrupted job key bound to another Mission before probing",async()=>{
    mocks.missionGet.mockResolvedValue({
      ...mission("html"),targetConnection:{adapter:"artifact"},
    });
    mocks.lookup.mockResolvedValue({
      id:"misbound",missionId:"other-mission",type:"campaign",
      status:"running",outputRef:"wrun-suspicious",
    });
    const result=await startRoute(post("corrupted"));
    expect(result).toMatchObject({error:expect.stringContaining("类型不匹配")});
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
  it("blocks a different idempotency key when the same HTML Mission has an active persisted Workflow",async()=>{
    const existing={id:"workflow-control-old",missionId:"audit-html-start",
      type:"campaign",status:"running",outputRef:"wrun-original"};
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.lookup.mockResolvedValue(undefined);
    mocks.activeJobs.mockResolvedValue([existing]);
    const result=await startRoute(post("new-key-after-reload"));
    expect(result).toMatchObject({
      code:"MISSION_WORKFLOW_ALREADY_ACTIVE",
      controlJobId:"workflow-control-old",runId:"wrun-reused",
      error:expect.stringContaining("已有未结束"),
    });
    expect(mocks.activeJobs).toHaveBeenCalledExactlyOnceWith("audit-html-start",100);
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("blocks an old active Campaign even when it lacks the workflow-control key prefix",async()=>{
    const legacy={id:"legacy-html-job",missionId:"audit-html-start",type:"campaign",
      status:"waiting",idempotencyKey:"legacy-run:older-controller"};
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.activeJobs.mockResolvedValue([legacy]);
    const result=await startRoute(post("a-different-start-key"));
    expect(result).toMatchObject({code:"MISSION_WORKFLOW_ALREADY_ACTIVE",controlJobId:legacy.id});
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("never exempts multiple waiting Campaign Jobs during an authorized experiment retry",async()=>{
    const waiting=(id:string)=>({id,missionId:"audit-html-start",type:"campaign",
      status:"waiting",idempotencyKey:`workflow-control:audit-html-start:${id}`});
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.activeJobs.mockResolvedValue([waiting("wait-a"),waiting("wait-b")]);
    recovery.serverWait.mockReturnValue("valid-frozen-checkpoint");
    const result=await startRoute(post("experiment-judge-retry:known-checkpoint"));
    expect(recovery.serverWait).toHaveBeenCalled();
    expect(result).toMatchObject({code:"MISSION_WORKFLOW_ALREADY_ACTIVE",
      error:expect.stringContaining("多条")});
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("passes a verified single waiting recovery to the guarded SQL RPC",async()=>{
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.activeJobs.mockResolvedValue([{
      id:"old-wait",missionId:"audit-html-start",type:"campaign",status:"waiting",
      idempotencyKey:"workflow-control:audit-html-start:old-wait",
    }]);
    recovery.serverWait.mockReturnValue("validated-checkpoint");
    mocks.preflight.mockResolvedValue(undefined);
    mocks.createJob.mockResolvedValue({reused:true,job:{
      id:"existing-job",missionId:"audit-html-start",type:"campaign",status:"running",outputRef:"wrun-reused",
    }});
    const result=await startRoute(post("experiment-judge-retry:validated-checkpoint"));
    expect(result).toMatchObject({reused:true,runId:"wrun-reused"});
    expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({type:"campaign"}),{
      kind:"html-campaign",allowSingleWaitingRetry:true,
    });
  });
  it("reports a racing SQL-active Job as 409 without starting a second Workflow",async()=>{
    const {JobStateConflictError}=await import("./production-runtime");
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.activeJobs.mockResolvedValue([]);
    mocks.preflight.mockResolvedValue(undefined);
    mocks.createJob.mockRejectedValue(new JobStateConflictError("new-job","mission-active",{
      id:"other-control",missionId:"audit-html-start",type:"campaign",status:"queued",
      idempotencyKey:"workflow-control:audit-html-start:earlier",
    } as never));
    const result=await startRoute(post("different-simultaneous-key"));
    expect(result).toMatchObject({code:"MISSION_WORKFLOW_ALREADY_ACTIVE",controlJobId:"other-control"});
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("requires the guarded SQL RPC for new HTML starts, never a generic fallback",async()=>{
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.activeJobs.mockResolvedValue([]);
    mocks.preflight.mockResolvedValue(undefined);
    mocks.createJob.mockRejectedValue(new Error("RPC create_evolution_html_campaign_control missing"));
    await expect(startRoute(post("must-be-atomic"))).rejects.toThrow("missing");
    expect(mocks.createJob).toHaveBeenCalledWith(expect.anything(),{
      kind:"html-campaign",allowSingleWaitingRetry:false,
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("fails closed when the active Job query itself is unavailable",async()=>{
    mocks.missionGet.mockResolvedValue(mission("html"));
    mocks.activeJobs.mockRejectedValue(new Error("PostgreSQL jobs unavailable"));
    await expect(startRoute(post("new-key"))).rejects.toThrow(/jobs unavailable/);
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("preserves existing Markdown server workflows and idempotent Job receipts",async()=>{
    mocks.missionGet.mockResolvedValue(mission("md"));
    mocks.preflight.mockResolvedValue(undefined);
    mocks.createJob.mockResolvedValue({
      reused:true,job:{id:"reused-job",status:"running",outputRef:"wrun-reused"},
    });
    const result=await startRoute(post());
    expect(result).toMatchObject({missionId:"audit-html-start",controlJobId:"reused-job",
      runId:"wrun-reused",reused:true});
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.createJob).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("requires operator execution permission for billable Sandbox and Chromium GET probes",async()=>{
    sandboxProbe.basic.mockResolvedValue({ready:false,message:"unavailable",policy:{codeReady:true}});
    sandboxProbe.browser.mockResolvedValue({ready:false,message:"unavailable"});
    await sandboxHealthRoute(get("http://localhost/api/evolution/sandbox-health"));
    await browserHealthRoute(get("http://localhost/api/evolution/browser-health"));
    expect(mocks.permission).toHaveBeenCalledTimes(2);
    expect(mocks.permission.mock.calls.map(call=>call[1])).toEqual(["target.execute","target.execute"]);
    expect(sandboxProbe.basic).toHaveBeenCalledOnce();
    expect(sandboxProbe.browser).toHaveBeenCalledOnce();
  });
});
