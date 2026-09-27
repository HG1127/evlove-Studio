import {afterEach,describe,expect,it,vi} from "vitest";
import {ingestServerOutcomeSamples,getServerOutcomeAnalysis} from "./server-outcome-client";
import {verifyServerEvidenceLedger} from "./server-evidence-ledger-client";

const at="2026-09-24T00:00:00.000Z";
const reply=(value:unknown)=>vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(value),{status:200})));

describe("server Outcome and Evidence identity",()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it("rejects an Outcome write receipt for another Mission",async()=>{
    const input={missionId:"mission-expected",samples:[{
      arm:"candidate" as const,metricKey:"conversion",metricKind:"business" as const,
      direction:"higher" as const,value:0.2,segment:"all",source:"manual",observedAt:at,metadata:{},
    }]};
    reply({missionId:"mission-expected",inserted:1,message:"recorded"});
    await expect(ingestServerOutcomeSamples(input)).resolves.toMatchObject({inserted:1});
    reply({missionId:"mission-other",inserted:1,message:"recorded"});
    await expect(ingestServerOutcomeSamples(input)).rejects.toThrow("Outcome write Mission identity mismatch");
  });

  it("rejects Outcome analysis for another Mission or explicit Candidate",async()=>{
    const analysis={missionId:"mission-expected",candidateId:"candidate-expected",checkedAt:at,
      sampleCount:0,minimumSamplesPerArm:1,metrics:[],drift:[],regressions:[],
      verdict:"insufficient",message:"No samples"};
    reply(analysis);
    await expect(getServerOutcomeAnalysis("mission-expected","candidate-expected"))
      .resolves.toMatchObject({candidateId:"candidate-expected"});
    reply({...analysis,missionId:"mission-other"});
    await expect(getServerOutcomeAnalysis("mission-expected","candidate-expected"))
      .rejects.toThrow("Outcome analysis identity mismatch");
    reply({...analysis,candidateId:"candidate-other"});
    await expect(getServerOutcomeAnalysis("mission-expected","candidate-expected"))
      .rejects.toThrow("Outcome analysis identity mismatch");
  });

  it("rejects Evidence verification for another Mission",async()=>{
    const verification={missionId:"mission-expected",valid:true,entries:0,
      contentHashesValid:true,signaturesValid:true,chainValid:true,checkedAt:at,message:"Valid"};
    reply(verification);
    await expect(verifyServerEvidenceLedger("mission-expected")).resolves.toMatchObject({valid:true});
    reply({...verification,missionId:"mission-other"});
    await expect(verifyServerEvidenceLedger("mission-expected"))
      .rejects.toThrow("Evidence Ledger Mission identity mismatch");
  });
});