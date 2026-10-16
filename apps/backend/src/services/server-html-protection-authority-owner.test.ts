// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvolutionJobSchema, type EvolveProject } from "@evolution/contracts";
import { serverBaselineFingerprint } from "@evolution/harness";
import { campaignScoringInputFingerprint } from "@evolution/core";
import { acceptedPackageFixture } from "@evolution/testkit";
import { assertServerHtmlProtectionOwner, prepareServerHtmlProtectionNormalBaselineView, type ServerHtmlProtectionOwnerPorts } from "./server-html-protection-authority-owner";
import {ServerAiPublicSelectionSchema,serverAiPublicSelectionIdentity,serverAiPublicSelectionRoute} from "./server-ai-public-selection";
import {serverAiPublicScoringRouteFingerprint} from "./ai-gateway";
function fixture() {
  const project = structuredClone(acceptedPackageFixture().project), operationKey = "workflow-control:" + project.id + ":authority";
  project.campaign.status = "running"; project.attentionRequests = [];
  project.campaign.serverControlOwner = { schemaVersion: "server-workflow-control-owner-v1", phase: "bound", controlJobId: "control",
    operationKey, sourceUpdatedAt: project.updatedAt, inputFingerprint: "a".repeat(64), requestedAt: "2026-10-14T12:00:00Z", runId: "sdk-run" };
  const execution = { executionId: "sdk-run", jobId: "control", generation: 1 };
  const job = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: "control", missionId: project.id, type: "campaign", status: "running",
    label: "authority", idempotencyKey: operationKey, generation: 1, outputRef: "sdk-run", createdAt: "2026-10-14T12:00:00Z", updatedAt: "2026-10-14T12:00:00Z" });
  const stored = structuredClone(project);
  const ports: ServerHtmlProtectionOwnerPorts = { readMission: vi.fn(async () => structuredClone(stored)),
    readJob: vi.fn(async () => structuredClone(job)), readRun: vi.fn(async () => ({ exists: true, status: "running" })), readRoute: vi.fn(async () => "selected-direct-route") };
  return { project, stored, job, execution, ports, args: { project, execution, active: true, scoringRouteFingerprint: "selected-direct-route" } };
}
describe("independent whole protection workflow owner", () => {
  it("checks actual Mission, Job, SDK Run and selected route before and after awaits", async () => {
    const f = fixture(); expect(await assertServerHtmlProtectionOwner(f.args, f.ports)).toMatchObject({ execution: f.execution, scoringRouteFingerprint: "selected-direct-route" });
    expect(f.ports.readMission).toHaveBeenCalledTimes(2); expect(f.ports.readJob).toHaveBeenCalledTimes(2);
  });
  it.each(["paused", "stopped", "completed", "round", "owner", "authorization", "candidate-content", "candidate-receipt", "draft-intent", "champion", "caller", "baseline-epoch", "scoring-route", "hidden-receipt", "acceptance-receipt"] as const)("rejects %s mutation during route await", async kind => {
    const f = fixture();
    f.ports.readRoute = async () => {
      if (kind === "paused" || kind === "stopped" || kind === "completed") f.stored.campaign.status = kind;
      if (kind === "round") f.stored.campaign.currentRound++;
      if (kind === "owner") f.stored.campaign.serverControlOwner!.operationKey += "changed";
      if (kind === "authorization") f.stored.attentionRequests = [{ id: "new", type: "authorization", status: "pending", blocking: true } as never];
      if (kind === "candidate-content") f.stored.candidates[0]!.artifactSnapshots[0]!.content += "changed";
      if (kind === "candidate-receipt") f.stored.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!.blobId += "changed";
      if (kind === "draft-intent") f.stored.candidates[0]!.change += "different initial intent";
      if (kind === "champion") f.stored.searchChampion = { id: "other" } as never;
      if(kind==="baseline-epoch")f.stored.baselineRun.id+="-new";
      if(kind==="scoring-route")f.stored.campaign.scoringRouteFingerprint="another-selected-route";
      if(kind==="hidden-receipt")f.stored.validationRun.id+="-new";
      if(kind==="acceptance-receipt")f.stored.artifactAcceptance.id+="-new";
      if (kind === "caller") f.project.candidates[0]!.artifactSnapshots[0]!.content += "changed";
      return "selected-direct-route";
    };
    await expect(assertServerHtmlProtectionOwner(f.args, f.ports)).rejects.toThrow("changed-after-await");
  });
  it.each(["key", "generation", "run", "mission", "status"] as const)("rejects actual Job %s drift", async kind => {
    const f = fixture();
    if (kind === "key") f.job.idempotencyKey += "another";
    if (kind === "generation") f.job.generation++;
    if (kind === "run") f.job.outputRef = "another-run";
    if (kind === "mission") f.job.missionId = "other";
    if (kind === "status") f.job.status = "failed";
    await expect(assertServerHtmlProtectionOwner(f.args, f.ports)).rejects.toThrow("job-generation-changed");
  });
});

describe("full saved selection owner binding (controlled reader ports)",()=>{
  function selected(){const f=fixture(),selection=ServerAiPublicSelectionSchema.parse({version:"server-ai-public-selection-v1",source:"vault",settings:{connectionId:"synthetic",label:"Synthetic",baseUrl:"https://provider.example.test/v1",model:"synthetic-model",protocol:"chat-completions",responseFormat:"json-schema"},
    metadata:{id:"server-ai-default-connection-v1",workspaceId:"synthetic-workspace",name:"Synthetic default",purpose:"Synthetic test",scopes:["ai:default-connection"],version:1,keyId:"synthetic-encryption",algorithm:"aes-256-gcm",createdBy:"synthetic-human",createdAt:"2026-10-14T11:00:00Z",updatedAt:"2026-10-14T11:00:00Z"},sealedRecordSha256:"9".repeat(64)});
    const identity=serverAiPublicSelectionIdentity(selection),route=serverAiPublicScoringRouteFingerprint(serverAiPublicSelectionRoute(selection));
    f.ports.readSelection=vi.fn<NonNullable<ServerHtmlProtectionOwnerPorts["readSelection"]>>(async()=>({availability:"available",selection:structuredClone(selection),selectionIdentitySha256:serverAiPublicSelectionIdentity(selection)}));
    f.ports.readRoute=vi.fn(async()=>"stale-pinned-legacy-route");return {...f,selection,args:{...f.args,scoringRouteFingerprint:route,selectionIdentitySha256:identity}};}
  it("uses complete public saved selection rather than the old pinned scalar route",async()=>{const f=selected(),result=await assertServerHtmlProtectionOwner(f.args,f.ports);
    expect(result.selection).toEqual(f.selection);expect(result.selectionIdentitySha256).toBe(f.args.selectionIdentitySha256);expect(f.ports.readRoute).not.toHaveBeenCalled();});
  it.each(["label","connectionId","model","protocol","format","metadata","key-only-same-revision"] as const)("rejects late %s replacement with unchanged unrelated owner",async kind=>{
    const f=selected();let calls=0;f.ports.readSelection=async()=>{const selection=structuredClone(f.selection);if(++calls===2){
      if(kind==="label"||kind==="connectionId"||kind==="model")selection.settings[kind]+="changed";
      if(kind==="protocol")selection.settings.protocol="responses";if(kind==="format")selection.settings.responseFormat="json-object";
      if(kind==="metadata")selection.metadata.name+="changed";if(kind==="key-only-same-revision")selection.sealedRecordSha256="8".repeat(64);
    }return {availability:"available",selection,selectionIdentitySha256:serverAiPublicSelectionIdentity(selection)};};
    await expect(assertServerHtmlProtectionOwner(f.args,f.ports)).rejects.toThrow("changed-after-await");});
  it("refuses an available DTO whose claimed identity does not bind all public selection material",async()=>{const f=selected();f.ports.readSelection=async()=>({availability:"available",selection:f.selection,selectionIdentitySha256:"7".repeat(64)});
    await expect(assertServerHtmlProtectionOwner(f.args,f.ports)).rejects.toThrow("selection-identity-drift");});
  it("refuses an unversioned environment or removed saved record instead of assigning an implicit credential epoch",async()=>{const f=selected();f.ports.readSelection=async()=>({availability:"unavailable",reason:"environment-credential-epoch-unavailable"});
    await expect(assertServerHtmlProtectionOwner(f.args,f.ports)).rejects.toThrow("current-selection-unavailable");});
  it("rejects Key-only same-revision replacement inside the final Mission read before returning an unchanged Mission",async()=>{
    const f=selected();let reads=0;f.ports.readMission=async()=>{if(++reads===2)f.selection.sealedRecordSha256="8".repeat(64);return structuredClone(f.stored);};
    await expect(assertServerHtmlProtectionOwner(f.args,f.ports)).rejects.toThrow("changed-after-await");
    expect(reads).toBe(2);expect(f.selection.metadata.version).toBe(1);expect(f.selection.metadata.updatedAt).toBe("2026-10-14T11:00:00Z");
  });
});

afterEach(()=>vi.restoreAllMocks());
describe("private normal Baseline epoch allocation",()=>{
  const startedAt="2026-10-14T12:00:01.000Z";
  function allocation(){const f=fixture();vi.spyOn(Date,"now").mockReturnValue(Date.parse("2026-10-14T12:00:02Z"));f.project.campaign.currentRound=0;f.stored.campaign.currentRound=0;
    const project:EvolveProject={...f.project,baselineRun:{...f.project.baselineRun,id:`baseline-server-${Date.parse(startedAt)}`,status:"running",startedAt,completedAt:undefined,totalCases:f.project.evalSuite.length,runs:[],result:undefined,measurementFingerprint:serverBaselineFingerprint(f.project,"selected-direct-route")},stage:"baseline",updatedAt:startedAt};return {...f,allocated:project};}
  it("allows the independently bound normal old-stored/new-allocated pair, while a JSON copy has no capability",async()=>{
    const f=allocation(),view=await prepareServerHtmlProtectionNormalBaselineView({inputProject:f.project,allocatedProject:f.allocated},f.ports);
    expect(view.campaign.scoringRouteFingerprint).toBe("selected-direct-route");expect(view.campaign.scoringInputFingerprint).toBe(campaignScoringInputFingerprint(f.project));
    await expect(assertServerHtmlProtectionOwner({...f.args,project:view},f.ports)).resolves.toBeDefined();
    await expect(assertServerHtmlProtectionOwner({...f.args,project:structuredClone(view)},f.ports)).rejects.toThrow("input-generation-changed");
  });
  it.each(["id","start","future","fingerprint","suite","cases","paper","result","candidate","owner","route"] as const)("refuses non-normal allocated %s",async kind=>{
    const f=allocation();if(kind==="id")f.allocated.baselineRun.id+="-fake";if(kind==="start")f.allocated.baselineRun.startedAt="2026-10-14T12:00:01.100Z";
    if(kind==="future"){f.allocated.baselineRun.startedAt="2026-10-14T13:00:00Z";f.allocated.baselineRun.id=`baseline-server-${Date.parse(f.allocated.baselineRun.startedAt)}`;}
    if(kind==="fingerprint")f.allocated.baselineRun.measurementFingerprint="arbitrary";if(kind==="suite")f.allocated.baselineRun.suiteName="other";if(kind==="cases")f.allocated.baselineRun.totalCases++;
    if(kind==="paper")f.allocated.hiddenEvalSuite=structuredClone(f.allocated.hiddenEvalSuite).map(test=>({...test,input:test.input+"-changed"}));
    if(kind==="result")f.allocated.baselineRun.result=f.project.baselineRun.result;
    if(kind==="candidate")f.allocated.candidates=structuredClone(f.allocated.candidates).map(candidate=>({...candidate,change:candidate.change+"other"}));
    if(kind==="owner")f.allocated.campaign={...f.allocated.campaign,serverControlOwner:{...f.allocated.campaign.serverControlOwner!,operationKey:"foreign"}};
    if(kind==="route")f.allocated.campaign={...f.allocated.campaign,scoringRouteFingerprint:"foreign"};
    await expect(prepareServerHtmlProtectionNormalBaselineView({inputProject:f.project,allocatedProject:f.allocated},f.ports)).rejects.toThrow();
  });
  it.each(["baseline","route","candidate","paused"] as const)("refuses actual stored %s drift after private allocation",async kind=>{
    const f=allocation(),view=await prepareServerHtmlProtectionNormalBaselineView({inputProject:f.project,allocatedProject:f.allocated},f.ports);
    if(kind==="baseline")f.stored.baselineRun.id+="-another";if(kind==="route")f.stored.campaign.scoringRouteFingerprint="another";
    if(kind==="candidate")f.stored.candidates[0]!.artifactSnapshots[0]!.content+="-different";if(kind==="paused")f.stored.campaign.status="paused";
    await expect(assertServerHtmlProtectionOwner({...f.args,project:view},f.ports)).rejects.toThrow();
  });
});

describe("late SDK and selected route restoration boundary",()=>{
  it.each(["sdk-cancelled","route-changed"] as const)("rejects %s after the first observation during metadata awaits",async kind=>{
    const f=fixture();let sdk="running",route="selected-direct-route";f.ports.readRun=async()=>({exists:true,status:sdk});f.ports.readRoute=async()=>route;
    const readJob=f.ports.readJob;let reads=0;f.ports.readJob=async id=>{const job=await readJob(id);if(++reads===2){if(kind==="sdk-cancelled")sdk="cancelled";else route="different-route";}return job;};
    await expect(assertServerHtmlProtectionOwner({...f.args,active:false},f.ports)).rejects.toThrow("changed-after-await");
  });
  it("allows a genuinely completed historical owner without requiring a live measurement",async()=>{
    const f=fixture();f.job.status="completed";f.project.campaign.status="completed";f.stored.campaign.status="completed";f.ports.readRun=async()=>({exists:true,status:"completed"});
    await expect(assertServerHtmlProtectionOwner({...f.args,active:false},f.ports)).resolves.toBeDefined();
  });
});
