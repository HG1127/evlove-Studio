// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {missionEnvelope,type EvolveProject,type ServerWorkflowControlOwner} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {assertClientControlOwnerMutationSafe,assertClientMissionMutationSafe} from "./mission-mutation-policy";
import post from "../../server/api/evolution/missions.post";
import put from "../../server/api/evolution/missions/[id].put";
const mocks=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),cas:vi.fn(),id:vi.fn()}));
vi.mock("./production-runtime",async(original)=>({...await original<typeof import("./production-runtime")>(),getServerMissionEnvelope:mocks.get,createServerMissionEnvelope:mocks.create,compareAndSwapServerMissionEnvelope:mocks.cas}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:vi.fn()}));
vi.mock("nitro/h3",async(original)=>({...await original<typeof import("nitro/h3")>(),getRouterParam:mocks.id}));
const project=acceptedPackageFixture().project;
const owner:ServerWorkflowControlOwner={schemaVersion:"server-workflow-control-owner-v1",controlJobId:"control",operationKey:"workflow-control:"+project.id+":key",sourceUpdatedAt:project.updatedAt,requestedAt:"2026-10-12T03:00:00Z",inputFingerprint:"a".repeat(64),phase:"bound",runId:"run"};
const owned:EvolveProject={...project,campaign:{...project.campaign,serverControlOwner:owner}};
const event=(body:unknown)=>mockEvent(new Request("http://localhost/api/evolution/missions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
beforeEach(()=>{vi.resetAllMocks();mocks.id.mockReturnValue(project.id);});
describe("client cannot inject or replace server control ownership",()=>{
 it.each([undefined,project])("rejects injection into new or existing Mission %s",current=>{
  expect(()=>assertClientControlOwnerMutationSafe(current,owned)).toThrow("后台控制预留");
 });
 it("rejects replacement and removal but accepts unchanged owner during ordinary edits",()=>{
  expect(()=>assertClientMissionMutationSafe(owned,{...owned,campaign:{...owned.campaign,serverControlOwner:undefined}})).toThrow("后台控制预留");
  expect(()=>assertClientMissionMutationSafe(owned,{...owned,campaign:{...owned.campaign,serverControlOwner:{...owner,controlJobId:"foreign"}}})).toThrow("后台控制预留");
  expect(()=>assertClientMissionMutationSafe(owned,{...owned,name:"edit"})).not.toThrow();
 });
 it("Mission POST rejects injected owner before database creation",async()=>{
  await expect(post(event(owned))).rejects.toMatchObject({statusCode:409});expect(mocks.create).not.toHaveBeenCalled();
 });
 it.each([undefined,missionEnvelope(project,29)])("Mission PUT rejects injection even when row is missing",async(current)=>{
  mocks.get.mockResolvedValue(current);
  await expect(put(event(missionEnvelope(owned,29)))).rejects.toMatchObject({statusCode:409});expect(mocks.cas).not.toHaveBeenCalled();
 });
 it("Mission PUT with identical owner keeps normal revision enforcement",async()=>{
  mocks.get.mockResolvedValue(missionEnvelope(owned,29));mocks.cas.mockResolvedValue(missionEnvelope(owned,30));
  await expect(put(event(missionEnvelope({...owned,name:"edited"},29)))).resolves.toMatchObject({revision:30});
  expect(mocks.cas).toHaveBeenCalledOnce();
 });
});
