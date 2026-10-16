// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {acceptedPackageFixture} from "@evolution/testkit";
import {missionEnvelope} from "@evolution/contracts";
const mocks=vi.hoisted(()=>({permission:vi.fn(),read:vi.fn(),jobs:vi.fn(),prepare:vi.fn(),save:vi.fn()}));
vi.mock("nitro/h3",()=>({defineEventHandler:(handler:unknown)=>handler,readBody:async(event:{body:unknown})=>event.body,
  createError:(value:{statusCode:number;statusMessage:string})=>Object.assign(new Error(value.statusMessage),value)}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./production-runtime",()=>({getServerMissionEnvelope:mocks.read,getServerProductionRuntime:()=>({jobs:{list:mocks.jobs}}),compareAndSwapServerMissionEnvelopeWithEvent:mocks.save}));
vi.mock("./server-html-protection-operational-confirmation",()=>({prepareServerHtmlProtectionOperationalConfirmation:mocks.prepare}));
import handler from "../../server/api/evolution/html-protection-scope.post";
const original={sourceArtifactId:"source",sha256:"a".repeat(64),byteLength:100},digest="b".repeat(64);
function fixture(){
 const project=acceptedPackageFixture().project,envelope=missionEnvelope(project,2);
 const next={...project,htmlProtectionOperationalScope:{policy:"original-finite-operational-v2",confirmedBy:{actorId:"human",actorSource:"browser-session"},confirmedAt:"2026-10-16T08:00:00.000Z"}};
 mocks.permission.mockResolvedValue({id:"human",role:"operator",source:"browser-session"});
 mocks.read.mockResolvedValue(envelope);mocks.jobs.mockResolvedValue([]);
 mocks.prepare.mockResolvedValue({next,targetContractSha256:digest,original});mocks.save.mockResolvedValue({...envelope,revision:3});
 const body={missionId:project.id,expectedRevision:2,humanReviewNote:"Explicit human confirmation of complete operational scope",confirm:true,targetContractSha256:digest,original};
 return {envelope,body,run:(input:unknown=body)=>handler({body:input} as never)};
}
beforeEach(()=>vi.resetAllMocks());
describe("human operational-scope API admission",()=>{
 it("previews without writing and commits only an exact confirmed revision and physical input",async()=>{
  const f=fixture();expect(await f.run({missionId:f.body.missionId,expectedRevision:2,humanReviewNote:f.body.humanReviewNote,confirm:false})).toMatchObject({confirmed:false});
  expect(mocks.save).not.toHaveBeenCalled();
  expect(await f.run()).toMatchObject({confirmed:true,revision:3,universalProtectionProved:false});expect(mocks.save).toHaveBeenCalledOnce();
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({revision:2}),expect.objectContaining({missionId:f.body.missionId,
    type:"ActionCompleted",source:"backend-human-operational-scope",payload:expect.objectContaining({policy:"original-finite-operational-v2",original,targetContractSha256:digest,confirmedBy:{actorId:"human",actorSource:"browser-session"},universalProtectionProved:false})}));
 });
 it.each(["service","revision","job","target","original","race","forged-scope"] as const)("rejects %s without a confirmation write",async kind=>{
  const f=fixture(),body={...f.body};
  if(kind==="service")mocks.permission.mockResolvedValue({id:"service",role:"operator",source:"service-key"});
  if(kind==="revision")body.expectedRevision=1;
  if(kind==="job")mocks.jobs.mockResolvedValue([{type:"campaign",status:"completed"}]);
  if(kind==="target")body.targetContractSha256="c".repeat(64);
  if(kind==="original")body.original={...original,sha256:"c".repeat(64)};
  if(kind==="race")mocks.read.mockResolvedValueOnce(f.envelope).mockResolvedValue({...f.envelope,revision:3});
  const input=kind==="forged-scope"?{...body,policy:"chosen-subset",requiredControls:[]}:body;
  await expect(f.run(input)).rejects.toThrow();expect(mocks.save).not.toHaveBeenCalled();
 });
 it("allows completed intake parse records, while uncompleted parse work remains blocking",async()=>{
  const f=fixture();mocks.jobs.mockResolvedValue([{type:"parse",status:"completed"}]);await expect(f.run()).resolves.toMatchObject({confirmed:true});
  mocks.save.mockClear();mocks.jobs.mockResolvedValue([{type:"parse",status:"running"}]);await expect(f.run()).rejects.toThrow();expect(mocks.save).not.toHaveBeenCalled();
 });
});

it("reports an atomic Mission/event CAS refusal without reporting a successful confirmation",async()=>{
 const f=fixture();mocks.save.mockRejectedValue(Error("Controlled atomic CAS/event refusal"));
 await expect(f.run()).rejects.toThrow("Controlled atomic CAS/event refusal");expect(mocks.save).toHaveBeenCalledOnce();
});
