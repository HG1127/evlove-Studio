// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import type {EvolveProject,EvolutionJob,EvolutionActor,ServerWorkflowControlOwner} from "@evolution/contracts";
import {reviewedBinding} from "./reviewed-holdout-identity";
import route from "../../server/api/evolution/reviewed-holdout.post";
import previewRoute from "../../server/api/evolution/reviewed-holdout.get";
const m=vi.hoisted(()=>({actor:vi.fn(),runtime:vi.fn(),create:vi.fn(),bind:vi.fn(),preview:vi.fn(),allowed:vi.fn(),reserve:vi.fn(),
  dispatch:vi.fn(),bindOwner:vi.fn(),start:vi.fn(),metadata:vi.fn(),event:vi.fn()}));
vi.mock("workflow/api",()=>({start:m.start}));
vi.mock("../../../../workflows/evolution-reviewed-holdout",()=>({evolutionReviewedHoldoutWorkflow:()=>undefined}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:m.actor}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:m.runtime,createServerJobIdempotentReceipt:m.create,bindServerJobWorkflowRun:m.bind}));
vi.mock("./reviewed-holdout-admission",()=>({previewReviewedHoldout:m.preview}));
vi.mock("./workflow-control-owner",()=>({WorkflowControlOwnerError:class extends Error{},requireServerNewControlAllowed:m.allowed,
  reserveServerWorkflowControl:m.reserve,beginServerWorkflowDispatchForMission:m.dispatch,bindServerWorkflowOwner:m.bindOwner}));
vi.mock("./workflow-run-metadata",()=>({readWorkflowRunMetadata:m.metadata}));
vi.mock("./workflow-control-events",()=>({appendWorkflowControlEvent:m.event}));
let p:EvolveProject,jobs:EvolutionJob[],body:Record<string,unknown>,actor:EvolutionActor;
const request=()=>mockEvent(new Request("http://localhost/api/evolution/reviewed-holdout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
beforeEach(()=>{
  vi.resetAllMocks();p=reviewedHoldoutFixture().project;jobs=[];actor={id:"human",role:"operator",source:"browser-session"};
  body={binding:reviewedBinding(p,"a".repeat(64),"b".repeat(64),"route"),idempotencyKey:"confirmed",humanReviewNote:"Human confirms this exact REVIEW",preserveReview:true,preserveAcceptanceGates:true};
  m.actor.mockImplementation(async()=>actor);m.runtime.mockReturnValue({missions:{get:async()=>p},jobs:{list:async()=>jobs},events:{append:vi.fn()}});
  m.preview.mockResolvedValue({binding:body.binding,reviewNotes:p.baselineRun.result!.notes,preservationNotice:"REVIEW 保留；仅同一冻结文件的隔离隐藏验证；验收标准、保护要求和 Gate F 不豁免。"});
  m.reserve.mockImplementation(async(_p:EvolveProject,key:string)=>{const owner:ServerWorkflowControlOwner={
    schemaVersion:"server-workflow-control-owner-v1",controlJobId:"job-fresh",operationKey:key,requestedAt:p.updatedAt,
    sourceUpdatedAt:p.updatedAt,inputFingerprint:(body.binding as {inputSha256:string}).inputSha256,phase:"reserved"};
    p.campaign.serverControlOwner=owner;return owner;});
  m.create.mockImplementation(async(job:EvolutionJob)=>{jobs=[job];return {job,reused:false};});
  m.dispatch.mockImplementation(async()=>{p.campaign.serverControlOwner!.phase="dispatching";});
  m.start.mockResolvedValue({runId:"run-fresh"});
  m.bind.mockImplementation(async()=>{jobs[0]!.outputRef="run-fresh";return jobs[0];});
  m.bindOwner.mockImplementation(async()=>{p.campaign.serverControlOwner={...p.campaign.serverControlOwner!,phase:"bound",runId:"run-fresh"};});
  m.metadata.mockResolvedValue({exists:true,status:"completed"});
});
describe("governed explicit reviewed Holdout dispatch",()=>{
  it("starts exactly one dedicated Workflow and retains full Original REVIEW and old pair in the admission event",async()=>{
    expect(await route(request())).toMatchObject({runId:"run-fresh",controlJobId:"job-fresh",status:"queued"});
    expect(m.start).toHaveBeenCalledOnce();expect(m.event.mock.calls[0]![1].payload.priorBaseline.result.safety).toBe("REVIEW");
    expect(m.event.mock.calls[0]![1].payload.priorValidation).toEqual(p.validationRun);
    expect(m.start.mock.calls[0]![1][0].approval.request.binding).toEqual(body.binding);
    expect(m.dispatch).toHaveBeenCalledOnce();
  });
  it.each(["service","vercel-protected-internal"])("rejects source %s before reading files or starting",async source=>{
    actor={...actor,role:"admin",source:source as EvolutionActor["source"]};
    await expect(route(request())).rejects.toThrow("人工操作员");expect(m.preview).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();
  });
  it("requires explicit preservation",async()=>{body.preserveReview=false;await expect(route(request())).rejects.toThrow("明确人工确认");expect(m.create).not.toHaveBeenCalled();});
  it("rejects changed reviewed file/paper identity",async()=>{
    body.binding={...(body.binding as object),hiddenSha256:"f".repeat(64)};
    await expect(route(request())).rejects.toThrow("已变化");expect(m.reserve).not.toHaveBeenCalled();
  });
  it("rejects an active or unverifiable prior controller without new dispatch",async()=>{
    m.allowed.mockRejectedValue(new Error("active Run"));
    await expect(route(request())).rejects.toThrow("active Run");expect(m.create).not.toHaveBeenCalled();
  });
  it("reuses the same request without a second judge or Workflow start, including a completed Run",async()=>{
    await route(request());expect(await route(request())).toMatchObject({reused:true,runId:"run-fresh"});
    expect(m.start).toHaveBeenCalledOnce();expect(m.preview).toHaveBeenCalledOnce();
  });
  it.each(["request","actor","intent","generation"])("rejects same-key %s mismatch",async kind=>{
    await route(request());
    if(kind==="request")body.humanReviewNote="A different approval note";
    if(kind==="actor")actor.id="other";
    if(kind==="intent")jobs[0]!.metadata!.workflowIntent="ordinary";
    if(kind==="generation")jobs[0]!.generation=0;
    await expect(route(request())).rejects.toThrow("不一致");expect(m.start).toHaveBeenCalledOnce();
  });
  it("keeps an unknown start unknown and refuses a duplicate dispatch",async()=>{
    m.start.mockRejectedValue(new Error("lost ack"));
    await expect(route(request())).rejects.toThrow("启动结果尚未确认");
    await expect(route(request())).rejects.toThrow("启动结果尚未确认");
    expect(m.start).toHaveBeenCalledOnce();
  });
  it("cannot create another judgment using a new key for the same reviewed files/paper",async()=>{
    await route(request());body.idempotencyKey="another-key";
    await expect(route(request())).rejects.toThrow("不能新建评审重试");expect(m.start).toHaveBeenCalledOnce();
  });
  it("does not dispatch when audit append cannot be confirmed",async()=>{
    m.event.mockRejectedValue(new Error("audit unavailable"));
    await expect(route(request())).rejects.toThrow("audit unavailable");expect(m.dispatch).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();
  });
  it("recovers a lost owner-binding acknowledgement by the same key",async()=>{
    m.bindOwner.mockRejectedValueOnce(new Error("ack lost"));
    expect(await route(request())).toMatchObject({code:"WORKFLOW_OWNER_BIND_PENDING",runId:"run-fresh"});
    expect(await route(request())).toMatchObject({reused:true,runId:"run-fresh"});expect(m.start).toHaveBeenCalledOnce();
  });
  it("does not treat a missing SDK Run as verified/live",async()=>{
    await route(request());m.metadata.mockResolvedValue({exists:false});
    await expect(route(request())).rejects.toThrow("不存在");expect(m.start).toHaveBeenCalledOnce();
  });
  it("serves a read-only governed preview with no Job, start or audit mutation",async()=>{
    const out=await previewRoute(mockEvent(new Request("http://localhost/api/evolution/reviewed-holdout?missionId=mission")));
    expect(out.binding).toEqual(body.binding);expect(m.create).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();expect(m.event).not.toHaveBeenCalled();
  });
});
