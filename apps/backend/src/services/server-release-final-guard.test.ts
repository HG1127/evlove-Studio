// @vitest-environment node
// Core acceptance/restoration are controlled fixtures; these cases isolate time and subject binding, not real Mission acceptance.
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {AcceptanceCriterionSchema,ReleaseTargetSchema,type ReleaseApprovalGrant} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {expectedReleaseArtifactHashes} from "@evolution/core";
const mocks=vi.hoisted(()=>({restore:vi.fn(),stable:vi.fn(),readMission:vi.fn(),grant:vi.fn(),prepare:vi.fn(),provider:vi.fn(),readProxyConfig:vi.fn(),externalWrite:vi.fn(),missionSave:vi.fn(),eventAppend:vi.fn(),permission:vi.fn(),settle:vi.fn()}));
vi.mock("./server-html-protection-accepted-authority",()=>({restoreServerHtmlProtectionAcceptedProject:mocks.restore,serverHtmlProtectionAcceptedContext:(value:unknown)=>JSON.stringify(value)}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({missions:{get:mocks.readMission,save:mocks.missionSave},events:{append:mocks.eventAppend}})}));
vi.mock("./release-approval-store",()=>({getActiveReleaseApprovalGrant:mocks.grant,requireActiveReleaseApprovalGrant:mocks.grant}));
vi.mock("./server-http-release-artifacts",()=>({prepareServerHttpReleaseArtifacts:mocks.prepare}));
vi.mock("./http-target-gateway",()=>({releaseHttpTarget:mocks.provider}));
vi.mock("../server-env",()=>({getServerTargetProxyConfig:mocks.readProxyConfig,targetProxyCapabilities:()=>({}),getServerVercelReleaseConfig:()=>({})}));
vi.mock("nitro/h3",()=>({defineEventHandler:(handler:unknown)=>handler,readBody:(event:{body:unknown})=>event.body,createError:(input:{statusCode:number;statusMessage:string})=>Object.assign(new Error(input.statusMessage),input)}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./release-outcome-telemetry",()=>({recordConnectorReleaseOutcomeObservation:vi.fn(async()=>({recorded:false,inserted:0,reason:"synthetic-only",telemetry:{warnings:[]}})),recordHttpReleaseOutcomeObservation:vi.fn(async()=>({recorded:false,inserted:0,reason:"synthetic-only",telemetry:{warnings:[]}}))}));
vi.mock("@evolution/core",async()=>{const actual=await vi.importActual<typeof import("@evolution/core")>("@evolution/core");return {...actual,htmlProtectionAcceptanceBlocker:()=>undefined,deliveryReadiness:()=>({ready:true,reasons:[]}),applyReleaseResultToProject:mocks.settle,applyProductionLearningGovernance:(project:unknown)=>project};});
import manualRoute from "../../server/api/evolution/release-action.post";
import {executeServerReleaseProvider} from "./server-release-orchestration";
function fixture(){const f=acceptedPackageFixture(false),project=f.project;project.releaseTarget=ReleaseTargetSchema.parse({provider:"http",status:"connected",connectionId:"selected-http",mode:"progressive"});project.release.candidateId=f.current.id;project.release.stableDeploymentId="stored-stable";
  const stored=structuredClone(project),grant:ReleaseApprovalGrant={id:"approved",workspaceId:"workspace",missionId:project.id,candidateId:f.current.id,scope:"release",approvedBy:"human",approvedRole:"approver",approvedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()};
  mocks.restore.mockResolvedValue({project,candidate:f.current,assertStable:mocks.stable});mocks.stable.mockResolvedValue(undefined);mocks.readMission.mockImplementation(async()=>structuredClone(stored));mocks.grant.mockImplementation(async()=>structuredClone(grant));mocks.prepare.mockResolvedValue({candidate:f.current,frozenArtifacts:[]});mocks.provider.mockImplementation(async(_raw,guard?:()=>Promise<()=>void>)=>{const check=await guard?.();check?.();mocks.externalWrite();return {ok:true};});
  const args={action:"shadow" as const,artifactHashes:expectedReleaseArtifactHashes(f.current),stableDeploymentId:project.release.stableDeploymentId};return {project,stored,grant,args};}
beforeEach(()=>vi.resetAllMocks());
describe("final provider boundary (all calls mocked; no production/provider execution)",()=>{
  it.each(["sdk","route","authority-expired","grant-revoked","grant-renewed","gate-f","connection","stage","deployment"] as const)("does not reach the provider after late %s change during bytes preparation",async kind=>{
    const f=fixture();mocks.prepare.mockImplementation(async()=>{
      if(["sdk","route","authority-expired"].includes(kind))mocks.stable.mockRejectedValue(Error("independent late guard refusal"));
      if(kind==="grant-revoked")mocks.grant.mockRejectedValue(Error("release approval revoked"));if(kind==="grant-renewed")f.grant.id="different-approved-grant";
      if(kind==="gate-f")f.stored.artifactAcceptance.hardGatePass=false;if(kind==="connection")f.stored.releaseTarget!.connectionId="different";
      if(kind==="stage")f.stored.release.status="shadow";if(kind==="deployment")f.stored.release.deploymentId="different";
      return {candidate:f.project.candidates[0]!,frozenArtifacts:[]};});
    await expect(executeServerReleaseProvider(f.project,f.args,undefined,{...f.grant})).rejects.toThrow();expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("allows the mocked positive path only after the prepared byte await and independent final checks",async()=>{
    const f=fixture();await executeServerReleaseProvider(f.project,f.args,undefined,f.grant);expect(mocks.prepare).toHaveBeenCalledTimes(1);expect(mocks.stable).toHaveBeenCalled();expect(mocks.grant).toHaveBeenCalledTimes(5);expect(mocks.provider).toHaveBeenCalledTimes(1);
  });
  it("keeps rollback independent of new authority, approval and Candidate file requirements while pinning stored stable binding",async()=>{
    const f=fixture();f.project.release.status="shadow";f.stored.release.status="shadow";
    await executeServerReleaseProvider(f.project,{...f.args,action:"rollback",artifactHashes:[],deploymentId:f.project.release.stableDeploymentId});expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.grant).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.provider).toHaveBeenCalledTimes(1);
    mocks.provider.mockClear();f.stored.release.stableDeploymentId="different-stable";await expect(executeServerReleaseProvider(f.project,{...f.args,action:"rollback",artifactHashes:[],deploymentId:f.project.release.stableDeploymentId})).rejects.toThrow("stable binding changed");expect(mocks.provider).not.toHaveBeenCalled();
  });
});

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("prevents the actual HTTP write when the original grant expires only during synchronous configuration preparation after the async guard",async()=>{
  let clock=Date.parse("2026-10-15T01:00:00Z");vi.spyOn(Date,"now").mockImplementation(()=>clock);const f=fixture(),deadline=Date.parse(f.grant.expiresAt);
  const actual=await vi.importActual<typeof import("./http-target-gateway")>("./http-target-gateway"),fetch=vi.fn(async()=>{throw Error("must not perform external write");});vi.stubGlobal("fetch",fetch);
  const config={releaseUrl:"https://target.example.test/release",token:"synthetic-only",timeoutMs:1000};
  mocks.readProxyConfig.mockImplementation(()=>config);
  mocks.prepare.mockResolvedValue({candidate:f.project.candidates.find(candidate=>candidate.id===f.project.release.candidateId)!,frozenArtifacts:f.project.candidates.find(candidate=>candidate.id===f.project.release.candidateId)!.artifactSnapshots.map(snapshot=>({...snapshot.frozenArtifact!,contentBase64:Buffer.from(snapshot.content).toString("base64")}))});
  mocks.provider.mockImplementation(async(raw,guard?:()=>Promise<()=>void>)=>actual.releaseHttpTarget(raw,async()=>{const check=await guard!();mocks.readProxyConfig.mockImplementation(()=>{clock=deadline;return config;});return check;}));
  await expect(executeServerReleaseProvider(f.project,f.args,undefined,f.grant)).rejects.toThrow("expired");expect(fetch).not.toHaveBeenCalled();expect(mocks.externalWrite).not.toHaveBeenCalled();
});

function manualRollbackFixture(){const f=fixture();f.project.releaseTarget!.mode="preview-promote";f.project.release.status="shadow";const storedA=f.project.candidates.find(candidate=>candidate.id==="prior")!;
  f.project.release.candidateId=storedA.id;f.project.release.stableDeploymentId="stable-A";Object.assign(f.stored,structuredClone(f.project));
  mocks.permission.mockResolvedValue(undefined);mocks.missionSave.mockResolvedValue(undefined);mocks.eventAppend.mockResolvedValue(undefined);
  mocks.settle.mockImplementation(({project,candidate}:{project:typeof f.project;candidate:{id:string}})=>({...project,release:{...project.release,status:"rolled-back",candidateId:candidate.id}}));
  mocks.provider.mockImplementation(async(_raw,guard?:()=>Promise<()=>void>)=>{const check=await guard?.();check?.();mocks.externalWrite();return {ok:true,effectiveAction:"rollback",trafficPercent:0,deploymentId:"stable-A",stableDeploymentId:"stable-A",evidenceMode:"live",observedAt:"2026-10-15T01:00:00Z",note:"synthetic rollback"};});
  return {...f,storedA,winnerB:f.project.candidates.find(candidate=>candidate.id===f.project.experimentRun.winnerId)!};}
describe("manual rollback stored A versus current winner B (all writes mocked)",()=>{
  it("rejects explicit winner B before provider, settlement or save when stored release is A",async()=>{const f=manualRollbackFixture();await expect(manualRoute({body:{missionId:f.project.id,candidateId:f.winnerB.id,action:"rollback"}} as never)).rejects.toThrow("stored deployed subject");expect(mocks.provider).not.toHaveBeenCalled();expect(mocks.externalWrite).not.toHaveBeenCalled();expect(mocks.settle).not.toHaveBeenCalled();expect(mocks.missionSave).not.toHaveBeenCalled();});
  it("uses explicit stored A for outbound invocation, settlement and save even when winner B remains current",async()=>{const f=manualRollbackFixture();await manualRoute({body:{missionId:f.project.id,candidateId:f.storedA.id,action:"rollback"}} as never);expect(mocks.provider.mock.calls[0]![0].candidate.id).toBe(f.storedA.id);expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({candidate:expect.objectContaining({id:f.storedA.id})}));expect(mocks.missionSave).toHaveBeenCalledWith(expect.objectContaining({release:expect.objectContaining({candidateId:f.storedA.id})}));});
  it("binds actual Connector rollback payload and receipt to A's stable version; a receipt for B is rejected",async()=>{
    const f=manualRollbackFixture(),actual=await vi.importActual<typeof import("./connector-release")>("./connector-release"),at="2026-10-15T01:00:00Z";
    f.project.targetConnection={...f.project.targetConnection,adapter:"connector",connector:{connectorId:"synthetic-connector",targetId:"synthetic-target"},connectorSnapshot:{connectorId:"synthetic-connector",targetId:"synthetic-target",versionRef:"base-A",snapshotRef:"source",artifactId:"source",observedAt:at}};
    f.project.releaseTarget={...f.project.releaseTarget!,provider:"connector"};
    f.storedA.connectorBinding={connectorId:"synthetic-connector",targetId:"synthetic-target",baseVersionRef:"base-A",versionRef:"deployed-A",snapshotRef:"snapshot-A",artifactFingerprint:"fingerprint-A",evidenceRefs:[],observedAt:at};
    f.winnerB.connectorBinding={...f.storedA.connectorBinding,baseVersionRef:"base-B",versionRef:"deployed-B",artifactFingerprint:"fingerprint-B"};
    const execute=vi.fn(async(input:import("@evolution/contracts").ConnectorActionRequest):Promise<import("@evolution/contracts").ConnectorActionResponse>=>({connectorId:input.connectorId,operation:input.operation,targetId:input.targetId,ok:true,versionRef:"base-A",deploymentRef:"stable-A",evidenceRefs:[],observedAt:at,note:"synthetic",output:{effectiveAction:"rollback",trafficPercent:0,healthy:true,observationStatus:"healthy",environment:"production",stableDeploymentRef:"stable-A"}}));
    await actual.executeConnectorReleaseAction(f.project,{action:"rollback",artifactHashes:[],deploymentId:"stable-A",stableDeploymentId:"stable-A"},execute,()=>undefined);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({expectedVersionRef:"deployed-A",payload:expect.objectContaining({candidateId:f.storedA.id,candidateVersionRef:"deployed-A",stableVersionRef:"base-A",artifactFingerprint:"fingerprint-A"})}),undefined);
    execute.mockImplementation(async input=>({connectorId:input.connectorId,operation:input.operation,targetId:input.targetId,ok:true,versionRef:"base-B",evidenceRefs:[],observedAt:at,note:"foreign",output:{effectiveAction:"rollback",trafficPercent:0,healthy:true,observationStatus:"healthy",environment:"production"}}));
    await expect(actual.executeConnectorReleaseAction(f.project,{action:"rollback",artifactHashes:[]},execute,()=>undefined)).rejects.toThrow("stable base-A");
  });
});

describe("HTML authority deadline scope compatibility (controlled acceptance/restore fixtures)",()=>{
  function scopeFixture(kind:"markdown"|"html"|"unknown"){
    const f=fixture();f.project.acceptanceRubric=[AcceptanceCriterionSchema.parse({id:"PROTECT-ALL",title:"Preserve all Original",requirement:"Preserve all Original content",source:"protected-item",hardGate:true,protectedConstraint:true,minScore:95})];
    for(const source of f.project.sourceArtifacts.filter(item=>item.role==="target")){
      if(kind==="markdown"){source.name="original.md";source.extension="md";source.mimeType="text/markdown";source.textContent="# Synthetic Original\n";}
      if(kind==="unknown"){source.name="original.unknown";source.extension="unknown";source.mimeType="application/octet-stream";source.textContent="synthetic unknown format";}
    }
    for(const run of [...f.project.validationRun.baselineRuns,...f.project.validationRun.runs])run.htmlProtectionAuthorityRefs=undefined;
    Object.assign(f.stored,structuredClone(f.project));return f;
  }
  it("preserves the existing Markdown consumer path with the same grant/readiness fixture and no HTML refs",async()=>{
    const f=scopeFixture("markdown");await executeServerReleaseProvider(f.project,f.args,undefined,f.grant);expect(mocks.provider).toHaveBeenCalledTimes(1);expect(mocks.externalWrite).toHaveBeenCalledTimes(1);
  });
  it.each(["html","unknown"] as const)("refuses %s scope with a whole criterion but no original authority refs",async kind=>{
    const f=scopeFixture(kind);await expect(executeServerReleaseProvider(f.project,f.args,undefined,f.grant)).rejects.toThrow("Original whole authority deadline is unavailable");expect(mocks.provider).not.toHaveBeenCalled();expect(mocks.externalWrite).not.toHaveBeenCalled();
  });
  it("still binds Markdown to the unchanged original grant deadline",async()=>{
    let clock=Date.parse("2026-10-15T02:00:00Z");vi.spyOn(Date,"now").mockImplementation(()=>clock);const f=scopeFixture("markdown");mocks.prepare.mockImplementation(async()=>{clock=Date.parse(f.grant.expiresAt);return {candidate:f.project.candidates.find(candidate=>candidate.id===f.project.release.candidateId)!,frozenArtifacts:[]};});
    await expect(executeServerReleaseProvider(f.project,f.args,undefined,f.grant)).rejects.toThrow("expired");expect(mocks.provider).not.toHaveBeenCalled();expect(mocks.externalWrite).not.toHaveBeenCalled();
  });
});
