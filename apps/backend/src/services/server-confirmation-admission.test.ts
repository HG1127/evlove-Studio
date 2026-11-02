// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {ConfirmationEvidenceCatalogSchema,EvolveProjectSchema,EvolutionJobSchema,missionEnvelope,type ArtifactStorePort} from "@evolution/contracts";
import {confirmationMissionScopeText} from "@evolution/core";
import {absoluteCalibrationFixture,bindSyntheticCalibrationApprovals,pairedJudgeFixture} from "@evolution/testkit";
import {assertServerConfirmationAdmission} from "./server-confirmation-admission";
import {assertClientMissionMutationSafe} from "./mission-mutation-policy";
import register from "../../server/api/evolution/missions.post";
import start from "../../server/api/evolution/start.post";
import legacyStart from "../../server/api/evolution/harness-execute.post";
import jobs from "../../server/api/evolution/jobs.post";
import put from "../../server/api/evolution/missions/[id].put";

const mocks=vi.hoisted(()=>({store:vi.fn(),route:vi.fn(),create:vi.fn(),runtime:vi.fn(),createJob:vi.fn(),
  workflow:vi.fn(),probe:vi.fn(),current:vi.fn(),save:vi.fn(),prior:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:mocks.store}));
vi.mock("./ai-gateway",()=>({serverAiScoringRouteFingerprint:mocks.route}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:vi.fn()}));
vi.mock("workflow/api",()=>({start:mocks.workflow}));
vi.mock("../../../../workflows/evolution-mission",()=>({evolutionMissionWorkflow:vi.fn()}));
vi.mock("./html-browser-preflight",()=>({assertServerHtmlBrowserExecutionReady:mocks.probe}));
vi.mock("./production-runtime",()=>({createServerMissionEnvelope:mocks.create,getServerProductionRuntime:mocks.runtime,
  createServerJobIdempotent:mocks.createJob,createServerJobIdempotentReceipt:mocks.createJob,
  getServerJobByIdempotencyKey:mocks.prior,listServerActiveMissionCampaignJobs:async()=>[],
  getServerMissionEnvelope:mocks.current,compareAndSwapServerMissionEnvelope:mocks.save,
  bindServerJobWorkflowRun:vi.fn(),isBenignJobBookkeepingConflict:()=>false,
  JobStateConflictError:class extends Error{},MissionRevisionConflictError:class extends Error{}}));

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const hash="0".repeat(64);

/** All provenance, labels, provider scores and application logs here are SYNTHETIC. Never publish these pins. */
function synthetic(){
  const x=absoluteCalibrationFixture(),project=pairedJudgeFixture().project;
  project.campaign.stopCriteria.maxWallMinutes=30;
  project.sourceArtifacts[0]!.storageRef=project.sourceArtifacts[0]!.id;
  const blobs=new Map<string,string>(),metadata=new Map<string,object>();
  const add=(artifactId:string,text:string,missionId?:string)=>{
    const h=sha(text);blobs.set(artifactId,text);
    metadata.set(artifactId,{schemaVersion:"artifact-v1",id:artifactId,bucket:"private-test",objectPath:artifactId,
      mimeType:"text/plain",sizeBytes:Buffer.byteLength(text),sha256:h,createdAt:"2026-10-01T00:00:00Z",updatedAt:"2026-10-01T00:00:00Z",...(missionId?{missionId}:{})});
    return {artifactId,sha256:h};
  };
  const scenario=add("scenario","Synthetic application scenario"),events=add("events","Synthetic complete event log"),fault=add("fault","Synthetic fault evidence");
  x.plan.applicationScenarioSha256=scenario.sha256;
  Object.assign(x.app,{scenarioSha256:scenario.sha256,eventsSha256:events.sha256,faultInjectionEvidenceSha256:fault.sha256});
  const app=add("application",JSON.stringify(x.app));
  Object.assign(x.request,{applicationScenarioSha256:scenario.sha256,applicationEvidenceSha256:app.sha256});
  bindSyntheticCalibrationApprovals(x.plan,x.texts);
  const original=add(project.sourceArtifacts[0]!.id,project.sourceArtifacts[0]!.textContent!,project.id);
  const catalog=ConfirmationEvidenceCatalogSchema.parse({schemaVersion:"confirmation-evidence-catalog-v1",workspaceId:"test-workspace",missionId:project.id,
    missionScopeSha256:sha(confirmationMissionScopeText(project)),request:x.request,
    plan:add("plan",JSON.stringify(x.plan)),observations:x.observations.map((o,i)=>add("observation-"+i,JSON.stringify(o))),
    artifacts:[scenario,events,fault,app,...Array.from(x.texts,([h,text])=>add("text-"+h,text))],
    sources:[{sourceArtifactId:project.sourceArtifacts[0]!.id,...original,sizeBytes:project.sourceArtifacts[0]!.size}],
    preregistrationSha256:x.plan.preregistrationSha256,oracleApprovalSha256:x.plan.oracleApprovalSha256});
  const pin=()=>{
    const ref=add("catalog",JSON.stringify(catalog));
    project.experimentPolicy.confirmationAdmission={schemaVersion:"full-confirmation-mission-v1",catalogSha256:ref.sha256};
    vi.stubEnv("EVOLUTION_CONFIRMATION_TRUST",JSON.stringify({schemaVersion:"confirmation-server-trust-v1",missions:[{missionId:project.id,catalogArtifactId:ref.artifactId,catalogSha256:ref.sha256}]}));
  };
  pin();vi.stubEnv("EVOLUTION_WORKSPACE_ID","test-workspace");vi.stubEnv("VERCEL_GIT_COMMIT_SHA",x.plan.sourceCommit);
  mocks.route.mockResolvedValue(x.plan.scoringRouteFingerprint);
  const store:ArtifactStorePort={put:vi.fn(),delete:vi.fn(),get:vi.fn(async id=>blobs.has(id)?new Blob([blobs.get(id)!]):undefined),
    getMetadata:vi.fn(async id=>metadata.get(id) as Awaited<ReturnType<NonNullable<ArtifactStorePort["getMetadata"]>>>) };
  mocks.store.mockReturnValue(store);
  return {...x,project,catalog,blobs,metadata,store,pin,add};
}
function event(path:string,body:unknown){return mockEvent(new Request("http://localhost/api/evolution/"+path,{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));}
const rejected={status:422,data:{code:"CONFIRMATION_ADMISSION_REQUIRED"}};

describe("real full-confirmation admission composition (synthetic evidence only)",()=>{
  beforeEach(()=>{vi.stubEnv("EVOLUTION_CONFIRMATION_TRUST","");for(const m of Object.values(mocks))m.mockReset();});
  afterEach(()=>vi.unstubAllEnvs());
  it("permits ordinary historical Missions without claiming full-confirmation qualification or reading evidence",async()=>{
    await expect(assertServerConfirmationAdmission(pairedJudgeFixture().project,"registration")).resolves.toBeUndefined();
    expect(mocks.store).not.toHaveBeenCalled();expect(mocks.route).not.toHaveBeenCalled();
  });
  it("checks actual stored bytes and the existing Harness gate for both registration and execution",async()=>{
    const x=synthetic();
    for(const phase of ["registration","execution"] as const){
      expect(await assertServerConfirmationAdmission(x.project,phase)).toMatchObject({ready:true,grantsModelBudget:false,grantsNewTrialAuthority:false,technicalAcceptanceEstablished:false});
    }
    expect(x.store.get).toHaveBeenCalledWith("plan");expect(x.store.put).not.toHaveBeenCalled();
  });
  it("allows Mission-before-upload registration but requires canonical source custody before execution",async()=>{
    const x=synthetic();x.blobs.delete(x.catalog.sources[0]!.artifactId);x.metadata.delete(x.catalog.sources[0]!.artifactId);
    await expect(assertServerConfirmationAdmission(x.project,"registration")).resolves.toMatchObject({ready:true});
    await expect(assertServerConfirmationAdmission(x.project,"execution")).rejects.toMatchObject(rejected);
  });
  it("checks reference-file custody without requiring references to become paired Target arms",async()=>{
    const x=synthetic(),source={...x.project.sourceArtifacts[0]!,id:"reference-source",role:"reference" as const,storageRef:"reference-blob"};
    x.project.sourceArtifacts.push(source);
    x.catalog.sources.push({sourceArtifactId:source.id,...x.add(source.storageRef,source.textContent!,x.project.id),sizeBytes:source.size});
    x.catalog.missionScopeSha256=sha(confirmationMissionScopeText(x.project));x.pin();
    await expect(assertServerConfirmationAdmission(x.project,"execution")).resolves.toMatchObject({ready:true});
    x.blobs.delete(source.storageRef);
    await expect(assertServerConfirmationAdmission(x.project,"execution")).rejects.toMatchObject(rejected);
  });
  it.each(["unconfigured","omitted-policy","untrusted-pin","wrong-workspace","wrong-code","wrong-route","goal","paper","hidden","budget","source-inline","source-execution-inline","source-stored","custody","missing-observation","bad-observation","approval","application","events","anchor"])("fails closed for %s",async mode=>{
    const x=synthetic();let phase:"registration"|"execution"="execution";
    if(mode==="unconfigured")vi.stubEnv("EVOLUTION_CONFIRMATION_TRUST","");
    if(mode==="omitted-policy")delete x.project.experimentPolicy.confirmationAdmission;
    if(mode==="untrusted-pin")x.project.experimentPolicy.confirmationAdmission!.catalogSha256=hash;
    if(mode==="wrong-workspace")vi.stubEnv("EVOLUTION_WORKSPACE_ID","another-workspace");
    if(mode==="wrong-code")vi.stubEnv("VERCEL_GIT_COMMIT_SHA","b".repeat(40));
    if(mode==="wrong-route")mocks.route.mockResolvedValue("changed-route");
    if(mode==="goal")x.project.goal+=" changed";
    if(mode==="paper")x.project.evalSuite[0]!.input+=" changed";
    if(mode==="hidden")x.project.hiddenEvalSuite[0]!.input+=" changed";
    if(mode==="budget")x.project.campaign.candidateCount++;
    if(mode==="source-inline"){phase="registration";x.project.sourceArtifacts[0]!.textContent+=" changed";}
    if(mode==="source-execution-inline")x.project.sourceArtifacts[0]!.textContent+=" changed";
    if(mode==="source-stored")x.blobs.set(x.catalog.sources[0]!.artifactId,x.project.sourceArtifacts[0]!.textContent!.toLowerCase());
    if(mode==="custody")x.metadata.set(x.catalog.sources[0]!.artifactId,{...x.metadata.get(x.catalog.sources[0]!.artifactId),missionId:"another"});
    if(mode==="missing-observation")x.blobs.delete(x.catalog.observations[0]!.artifactId);
    if(mode==="bad-observation"){
      x.observations[2]!.receipt.samples[0].candidate.criteria[0]!.score=99;
      x.observations[2]!.receipt.samples[0].candidate.criteria[0]!.pass=true;
      x.catalog.observations[2]=x.add("observation-2",JSON.stringify(x.observations[2]));x.pin();
    }
    if(mode==="approval")x.blobs.delete("text-"+x.plan.oracleApprovalSha256);
    if(mode==="application")x.blobs.set("application",JSON.stringify({...x.app,deadlineStop:true}));
    if(mode==="events")x.blobs.delete("events");
    if(mode==="anchor")x.blobs.delete("text-"+x.plan.controls[0]!.anchors[0]!.sourceSha256);
    await expect(assertServerConfirmationAdmission(x.project,phase)).rejects.toMatchObject(rejected);
    expect(x.store.put).not.toHaveBeenCalled();expect(x.store.delete).not.toHaveBeenCalled();
  });
  it("rejects approved flags and prevents reference removal or protocol downgrade through generic PUT",()=>{
    const x=synthetic(),next=structuredClone(x.project);
    expect(EvolveProjectSchema.safeParse({...x.project,experimentPolicy:{...x.project.experimentPolicy,
      confirmationAdmission:{...x.project.experimentPolicy.confirmationAdmission,approved:true}}}).success).toBe(false);
    delete next.experimentPolicy.confirmationAdmission;
    expect(()=>assertClientMissionMutationSafe(x.project,next)).toThrow(/完整确认/);
    const downgrade=structuredClone(x.project);delete downgrade.experimentPolicy.judgeComparison;
    expect(()=>assertClientMissionMutationSafe(x.project,downgrade)).toThrow(/完整确认/);
  });
  it("keeps outputs and later final reservation outside the frozen input digest",()=>{
    const x=synthetic(),before=confirmationMissionScopeText(x.project);
    x.project.stage="experiment";x.project.campaign.status="completed";x.project.candidates=[];
    x.project.updatedAt=new Date().toISOString();
    expect(confirmationMissionScopeText(x.project)).toBe(before);
  });
  it("rejects real registration before persistence, then permits it only with verified synthetic evidence",async()=>{
    const x=synthetic();vi.stubEnv("EVOLUTION_CONFIRMATION_TRUST","");
    await expect(register(event("missions",x.project))).rejects.toMatchObject(rejected);
    expect(mocks.create).not.toHaveBeenCalled();x.pin();mocks.create.mockResolvedValue({missionId:x.project.id});
    await expect(register(event("missions",x.project))).resolves.toMatchObject({missionId:x.project.id});
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it.each(["start","legacy","jobs"])("blocks the real %s route before Job/Workflow/browser side effects",async entry=>{
    const x=synthetic();vi.stubEnv("EVOLUTION_CONFIRMATION_TRUST","");
    mocks.runtime.mockReturnValue({missions:{get:async()=>x.project}});
    const call=entry==="jobs"?jobs:entry==="legacy"?legacyStart:start;
    const payload=entry==="jobs"?{missionId:x.project.id,type:"mission-action",label:"Synthetic",idempotencyKey:"test"}:{missionId:x.project.id};
    await expect(call(event(entry,payload))).rejects.toMatchObject(rejected);
    expect(mocks.createJob).not.toHaveBeenCalled();expect(mocks.workflow).not.toHaveBeenCalled();expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("blocks the alternate PUT create path before compare-and-swap",async()=>{
    const x=synthetic();vi.stubEnv("EVOLUTION_CONFIRMATION_TRUST","");mocks.current.mockResolvedValue(undefined);
    const e=event("missions/"+x.project.id,missionEnvelope(x.project));
    e.context.params={id:x.project.id};
    await expect(put(e)).rejects.toMatchObject(rejected);expect(mocks.save).not.toHaveBeenCalled();
  });
  it("retrieves an existing strict Mission start receipt without spending or rechecking a new admission",async()=>{
    const x=synthetic();vi.stubEnv("EVOLUTION_CONFIRMATION_TRUST","");
    mocks.runtime.mockReturnValue({missions:{get:async()=>x.project}});
    const at="2026-10-02T00:00:00Z";
    mocks.prior.mockResolvedValue(EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"prior",missionId:x.project.id,
      type:"campaign",status:"running",label:"Prior",idempotencyKey:`workflow-control:${x.project.id}:same-request`,outputRef:"prior-run",createdAt:at,updatedAt:at}));
    await expect(start(event("start",{missionId:x.project.id,idempotencyKey:"same-request"}))).resolves.toMatchObject({reused:true,controlJobId:"prior",runId:"prior-run"});
    expect(mocks.createJob).not.toHaveBeenCalled();expect(mocks.workflow).not.toHaveBeenCalled();expect(mocks.probe).not.toHaveBeenCalled();
  });
});
