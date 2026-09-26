// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/outcome-analysis.get";
import {OutcomeSampleLimitExceededError} from "./outcome-sample-store";

const {permission,missionGet,resolveCandidate,analyze}=vi.hoisted(()=>({
  permission:vi.fn(),missionGet:vi.fn(),resolveCandidate:vi.fn(),analyze:vi.fn(),
}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:permission}));
vi.mock("./production-runtime",()=>({
  getServerProductionRuntime:()=>({missions:{get:missionGet}}),
}));
vi.mock("./outcome-ingestion",()=>({resolveOutcomeAnalysisCandidate:resolveCandidate}));
vi.mock("./outcome-analytics",()=>({analyzeMissionOutcome:analyze}));

function event(query="missionId=mission-1&candidateId=candidate-1"){
  return mockEvent(new Request("http://localhost/api/evolution/outcome-analysis?"+query));
}

describe("Outcome analysis route",()=>{
  beforeEach(()=>{
    permission.mockReset().mockResolvedValue(undefined);
    missionGet.mockReset().mockResolvedValue({id:"mission-1"});
    resolveCandidate.mockReset().mockReturnValue("candidate-1");
    analyze.mockReset();
  });

  it("returns an explicit limit error instead of reporting incomplete statistics",async()=>{
    analyze.mockRejectedValue(new OutcomeSampleLimitExceededError(20_000));
    await expect(route(event())).rejects.toMatchObject({status:422,
      statusMessage:"Outcome analysis exceeds the 20000 sample limit; complete evidence is required"});
    expect(permission).toHaveBeenCalledWith(expect.anything(),"data.read");
    expect(analyze).toHaveBeenCalledWith({missionId:"mission-1",candidateId:"candidate-1"});
  });

  it("returns complete analysis results",async()=>{
    analyze.mockResolvedValue({status:"insufficient",sampleCount:0});
    await expect(route(event())).resolves.toEqual({status:"insufficient",sampleCount:0});
  });

  it("still resolves the current Candidate when candidateId is omitted",async()=>{
    analyze.mockResolvedValue({status:"insufficient",sampleCount:0});
    await expect(route(event("missionId=mission-1"))).resolves.toEqual({status:"insufficient",sampleCount:0});
    expect(resolveCandidate).toHaveBeenCalledWith({id:"mission-1"},undefined);
  });

  it("rejects an empty or ambiguous Candidate instead of using the active Candidate",async()=>{
    for(const query of [
      "missionId=mission-1&candidateId=",
      "missionId=mission-1&candidateId=%20%20",
      "missionId=mission-1&candidateId=candidate-1&candidateId=candidate-2",
    ]){
      await expect(route(event(query))).rejects.toMatchObject({status:400});
    }
    expect(missionGet).not.toHaveBeenCalled();
    expect(resolveCandidate).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects an empty or ambiguous Mission scope before reading the Mission",async()=>{
    for(const query of [
      "missionId=",
      "missionId=%20%20",
      "missionId=mission-1&missionId=mission-2",
    ]){
      await expect(route(event(query))).rejects.toMatchObject({status:400});
    }
    expect(missionGet).not.toHaveBeenCalled();
  });
});
