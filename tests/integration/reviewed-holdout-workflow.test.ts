// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {evolutionReviewedHoldoutWorkflow} from "../../workflows/evolution-reviewed-holdout";
const m=vi.hoisted(()=>({initialize:vi.fn(),finalize:vi.fn(),execute:vi.fn(),accept:vi.fn()}));
vi.mock("../../workflows/evolution-mission/steps",()=>({initializeWorkflowControlStep:m.initialize,finalizeWorkflowResultStep:m.finalize}));
vi.mock("../../workflows/evolution-reviewed-holdout/steps",()=>({executeReviewedHoldoutStep:m.execute,acceptReviewedHoldoutStep:m.accept}));
const binding={schemaVersion:"reviewed-holdout-binding-v1",missionId:"m",sourceUpdatedAt:"at",baselineId:"b",baselineSha256:"a".repeat(64),
  candidateId:"C1",snapshotSha256:"b".repeat(64),frozenSha256:"c".repeat(64),originalSha256:"d".repeat(64),
  hiddenSha256:"e".repeat(64),inputSha256:"f".repeat(64),physicalSha256:"1".repeat(64),scoringRouteFingerprint:"route"};
const input={missionId:"m",controlJobId:"j",controlOwnerKey:"k",requestedAt:"at",approval:{schemaVersion:"reviewed-holdout-approval-v1",
  request:{binding,idempotencyKey:"same",humanReviewNote:"Human reviewed the exact record",preserveReview:true,preserveAcceptanceGates:true},
  actorId:"human",actorSource:"browser-session",confirmedAt:"at"}};
const result={missionId:"m",controlJobId:"j",status:"waiting-human",iterations:1,reason:"valid REVIEW retained"};
beforeEach(()=>{vi.resetAllMocks();m.finalize.mockImplementation(async(_input,result)=>result);});
describe("dedicated reviewed Workflow top-level step dispatch",()=>{
  it("stops on a valid REVIEW with exactly one Hidden step and no normal control/Baseline loop",async()=>{
    m.execute.mockResolvedValue({result});
    expect(await evolutionReviewedHoldoutWorkflow(input)).toEqual(result);
    expect(m.initialize).toHaveBeenCalledOnce();expect(m.execute).toHaveBeenCalledOnce();expect(m.accept).not.toHaveBeenCalled();expect(m.finalize).toHaveBeenCalledOnce();
  });
  it("passes only the actual private Hidden output into the separate Gate F step",async()=>{
    const continuation={fromActualStep:true};m.execute.mockResolvedValue({result,continuation});m.accept.mockResolvedValue({...result,status:"waiting-action"});
    await evolutionReviewedHoldoutWorkflow(input);
    expect(m.accept).toHaveBeenCalledExactlyOnceWith(input,continuation);
  });
  it("finalizes failure without retrying an ambiguous execution",async()=>{
    m.execute.mockRejectedValue(new Error("result save acknowledgement lost"));
    expect(await evolutionReviewedHoldoutWorkflow(input)).toMatchObject({status:"failed"});
    expect(m.execute).toHaveBeenCalledOnce();expect(m.accept).not.toHaveBeenCalled();
  });
});
