// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from "vitest";
import {H3} from "nitro/h3";
import {acceptedLegacyHtmlPaperFixture} from "@evolution/testkit";
import {runServerReleaseOrchestration} from "@evolution/harness";
const mocks=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),append:vi.fn(),grant:vi.fn(),execute:vi.fn(),http:vi.fn(),connector:vi.fn(),prepare:vi.fn()}));
vi.mock("../../apps/backend/src/services/production-runtime",()=>({getServerProductionRuntime:()=>({missions:{get:mocks.get,save:mocks.save},events:{append:mocks.append}})}));
vi.mock("../../apps/backend/src/services/security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("../../apps/backend/src/server-env",()=>({getServerVercelReleaseConfig:()=>({})}));
vi.mock("../../apps/backend/src/services/release-approval-store",()=>({requireActiveReleaseApprovalGrant:mocks.grant,getActiveReleaseApprovalGrant:mocks.grant}));
vi.mock("../../apps/backend/src/services/vercel-release",()=>({executeVercelReleaseAction:mocks.execute}));
vi.mock("../../apps/backend/src/services/http-target-gateway",()=>({releaseHttpTarget:mocks.http}));
vi.mock("../../apps/backend/src/services/connector-release",()=>({executeConnectorReleaseAction:mocks.connector}));
vi.mock("../../apps/backend/src/services/server-http-release-artifacts",()=>({prepareServerHttpReleaseArtifacts:mocks.prepare}));
vi.mock("../../apps/backend/src/services/release-outcome-telemetry",()=>({recordConnectorReleaseOutcomeObservation:vi.fn(),recordHttpReleaseOutcomeObservation:vi.fn()}));
import route from "../../apps/backend/server/api/evolution/release-action.post";
import {executeServerReleaseProvider} from "../../apps/backend/src/services/server-release-orchestration";
const app=new H3().post("/release-action",route);
function fixture(){
 const f=acceptedLegacyHtmlPaperFixture();
 f.project.releaseTarget={provider:"vercel",mode:"preview-promote",status:"connected",label:"Synthetic Release",healthPath:"/"};
 f.project.gates=[{id:"artifact-ready",status:"approved"},{id:"release-ready",status:"approved"}];
 f.project.release={...f.project.release,status:"idle",candidateId:f.current.id,deploymentId:"candidate-deployment",stableDeploymentId:"stable-deployment"};
 return f;
}
beforeEach(()=>{vi.resetAllMocks();mocks.grant.mockResolvedValue({id:"existing-unexpired-grant"});});
describe("prior HTML paper cannot reuse an existing Release approval",()=>{
 it.each(["shadow","canary-5","promote"] as const)("blocks API %s before grant lookup or any provider/write",async action=>{
  const f=fixture();mocks.get.mockResolvedValue(f.project);
  const response=await app.fetch(new Request("http://localhost/release-action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({missionId:f.project.id,candidateId:f.current.id,deploymentId:"candidate-deployment",action})}));
  expect(response.status).toBe(409);
  for(const operation of [mocks.grant,mocks.execute,mocks.http,mocks.connector,mocks.prepare,mocks.save,mocks.append])expect(operation).not.toHaveBeenCalled();
 });
 it.each(["vercel","http","connector"] as const)("blocks direct %s provider before I/O",async provider=>{
  const f=fixture();f.project.releaseTarget!.provider=provider;
  await expect(executeServerReleaseProvider(f.project,{action:"shadow",deploymentId:"candidate-deployment",artifactHashes:[]})).rejects.toThrow("html-protection-contract-pending");
  for(const operation of [mocks.execute,mocks.http,mocks.connector,mocks.prepare])expect(operation).not.toHaveBeenCalled();
 });
 it("persists a durable pause before using the old grant",async()=>{
  const f=fixture(),execute=vi.fn(),authorize=vi.fn(async()=>({ok:true}));
  const outcome=await runServerReleaseOrchestration(f.project,{execute,authorize});
  expect(outcome.control).toBe("stop");expect(outcome.reason).toContain("html-protection-contract-pending");
  expect(outcome.project.campaign.stopReason).toBe(outcome.reason);expect(execute).not.toHaveBeenCalled();expect(authorize).not.toHaveBeenCalled();
 });
 it("allows direct provider rollback without accepting the old paper",async()=>{
  const f=fixture();mocks.execute.mockResolvedValue({ok:true,effectiveAction:"rollback"});
  await expect(executeServerReleaseProvider(f.project,{action:"rollback",deploymentId:"stable-deployment",artifactHashes:[]})).resolves.toMatchObject({effectiveAction:"rollback"});
  expect(mocks.execute).toHaveBeenCalledTimes(1);
 });
 it("retains durable rollback for an unhealthy deployed version",async()=>{
  const f=fixture();f.project.release={...f.project.release,status:"promoted",healthy:false,evidenceMode:"live",observationStatus:"unhealthy"};
  const execute=vi.fn(async()=>({ok:true,effectiveAction:"rollback" as const,trafficPercent:0,note:"synthetic rollback",healthy:true,kpis:[],evidenceMode:"live" as const,observationStatus:"healthy" as const,deploymentId:"stable-deployment",stableDeploymentId:"stable-deployment",observedAt:new Date().toISOString()}));
  const authorize=vi.fn(async()=>({ok:true}));
  const outcome=await runServerReleaseOrchestration(f.project,{execute,authorize});
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({action:"rollback"}));expect(authorize).not.toHaveBeenCalled();expect(outcome.action).toBe("rollback");
 });
});
