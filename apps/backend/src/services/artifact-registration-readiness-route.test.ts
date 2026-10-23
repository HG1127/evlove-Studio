// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";

const mocks=vi.hoisted(()=>({health:vi.fn(),put:vi.fn(),append:vi.fn(),ledger:vi.fn(),mission:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn()}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({put:mocks.put})}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({
  missions:{get:mocks.mission},jobs:{get:vi.fn()},events:{append:mocks.append},
})}));
vi.mock("./evidence-ledger",()=>({getEvidenceLedgerHealth:mocks.health,appendEvidenceLedger:mocks.ledger}));
import registerRoute from "../../server/api/evolution/artifacts/register.post";

const healthy={configured:true,databaseReady:true,signingConfigured:true,appendFunctionReady:true,immutableTriggerReady:true};
const body={id:"real-source",missionId:"real-sop",kind:"source",mimeType:"text/html",content:"<html>complete original</html>"};
function event(input:unknown=body){return mockEvent(new Request("http://localhost/api/evolution/artifacts/register",{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),
}));}
beforeEach(()=>{
  vi.clearAllMocks();mocks.health.mockResolvedValue(healthy);mocks.mission.mockResolvedValue({id:"real-sop"});
  mocks.put.mockResolvedValue(undefined);mocks.append.mockResolvedValue(undefined);mocks.ledger.mockResolvedValue({id:"ledger-1"});
});

describe("Mission-bound artifact registration readiness",()=>{
  it.each([
    {signingConfigured:false},{databaseReady:false},{appendFunctionReady:false},{immutableTriggerReady:false},
  ])("reports the missing dependency before storing bytes or appending partial evidence: %j",async missing=>{
    mocks.health.mockResolvedValue({...healthy,...missing,configured:false});
    await expect(registerRoute(event())).rejects.toMatchObject({status:503,data:{code:"ARTIFACT_EVIDENCE_NOT_READY",missionId:"real-sop"}});
    expect(mocks.put).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(mocks.ledger).not.toHaveBeenCalled();
  });
  it("registers the exact bytes and deterministic receipts after the dependency is repaired",async()=>{
    mocks.health.mockResolvedValueOnce({...healthy,configured:false,signingConfigured:false});
    await expect(registerRoute(event())).rejects.toMatchObject({status:503});
    const result=await registerRoute(event());
    const sha256=createHash("sha256").update(body.content).digest("hex");
    expect(result).toMatchObject({id:body.id,missionId:body.missionId,sha256,size:Buffer.byteLength(body.content)});
    expect(mocks.put).toHaveBeenCalledOnce();
    const blob=mocks.put.mock.calls[0][1] as Blob;
    expect(await blob.text()).toBe(body.content);
    expect(mocks.ledger).toHaveBeenCalledWith(expect.objectContaining({id:`artifact-registration:${body.id}:${sha256}`,artifactRefs:[body.id]}));
  });
  it("preserves the unbound upload path without claiming Mission evidence",async()=>{
    await expect(registerRoute(event({...body,missionId:undefined}))).resolves.toMatchObject({id:body.id});
    expect(mocks.health).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(mocks.ledger).not.toHaveBeenCalled();
  });
});
