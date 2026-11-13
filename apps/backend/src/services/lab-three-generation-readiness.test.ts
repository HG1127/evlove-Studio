// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {inspectLabThreeGenerationReadiness,type LabExperimentReadinessPorts} from "./lab-three-generation-readiness";

const now=new Date("2026-11-13T08:00:00.000Z");
const safeEnv={
  EVOLUTION_EXPERIMENT_MODE:"isolated",
  EVOLUTION_LAB_EXPERIMENT_ARMED:"true",
  EVOLUTION_LAB_APPROVED_MISSION_ID:"lab-synthetic-html-three-rounds",
};
const gen={configured:true,connection:{model:"MiniMax-M3",baseUrl:"https://api.minimaxi.com/v1",apiKey:"SYNTHETIC_NEVER_SHOW"}};
const judge={configured:true,connection:{model:"MiniMax-M3.1-Flash",baseUrl:"https://api.minimaxi.com/v1",apiKey:"SYNTHETIC_JUDGE_SECRET"}};
function fixture():LabExperimentReadinessPorts{
  return {
    inspectIdentity:vi.fn(()=>({ready:true,codes:[]})),
    inspectJobs:vi.fn(async()=>({status:"clear" as const,issues:[]})),
    inspectMission:vi.fn(async()=>({exists:true,executableHtml:true})),
    roleStatus:vi.fn(async(role)=>role==="generation"?gen:judge),
  };
}

describe("P3-T zero-cost synthetic 3-generation Lab launch preflight",()=>{
  it("can report only a metadata preflight-clear, never authorize paid model calls",async()=>{
    const ports=fixture();
    const report=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
    expect(report).toMatchObject({
      mode:"read-only",status:"preflight-clear",blockers:[],
      executionAllowed:false,modelCallsPerformed:false,providerQuotaChecked:false,
      requiresSeparateModelAuthorization:true,orphanJobs:0,missionReady:true,
      generationModel:"MiniMax-M3",judgeModel:"MiniMax-M3.1-Flash",
      budget:{maxPhysicalCalls:6,maxMissionTokens:300000,maxDurationMinutes:20,minRemainingPercent:50},
    });
    expect(JSON.stringify(report)).not.toContain(gen.connection.apiKey);
    expect(JSON.stringify(report)).not.toContain(judge.connection.apiKey);
    expect(ports.inspectMission).toHaveBeenCalledExactlyOnceWith(safeEnv.EVOLUTION_LAB_APPROVED_MISSION_ID);
  });
  it("reports an unarmed missing Mission and existing orphans without mutating state",async()=>{
    const ports=fixture();
    ports.inspectJobs=vi.fn(async()=>({status:"blocked" as const,
      issues:[{reason:"mission-missing"},{reason:"mission-missing"}]}));
    const report=await inspectLabThreeGenerationReadiness({EVOLUTION_EXPERIMENT_MODE:"isolated"},ports,now);
    expect(report).toMatchObject({
      mode:"read-only",status:"blocked",orphanJobs:2,approvedMissionConfigured:false,
      missionReady:false,modelCallsPerformed:false,
    });
    expect(report.blockers).toEqual(expect.arrayContaining([
      "LAB_APPROVED_MISSION_REQUIRED","LAB_EXPERIMENT_NOT_ARMED","LAB_ORPHAN_ACTIVE_JOBS",
    ]));
    expect(ports.inspectMission).not.toHaveBeenCalled();
  });
  it("fails closed when the Mission is missing or not an executable synthetic HTML input",async()=>{
    for(const missionState of [
      {exists:false,executableHtml:false,blocker:"LAB_APPROVED_MISSION_NOT_FOUND"},
      {exists:true,executableHtml:false,blocker:"LAB_SYNTHETIC_HTML_REQUIRED"},
    ]){
      const ports=fixture();
      ports.inspectMission=vi.fn(async()=>missionState);
      const report=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
      expect(report.status).toBe("blocked");
      expect(report.blockers).toContain(missionState.blocker);
    }
  });
  it("blocks unknown inventories and never assumes empty or partial reads are clean",async()=>{
    const ports=fixture();
    ports.inspectJobs=vi.fn(async()=>({status:"unknown" as const,issues:[]}));
    let report=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
    expect(report).toMatchObject({status:"blocked",blockers:["LAB_JOB_INTEGRITY_UNVERIFIED"]});
    ports.inspectJobs=vi.fn(async()=>{throw Error("private internal database URI");});
    report=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
    expect(report).toMatchObject({status:"blocked",blockers:["LAB_JOB_INTEGRITY_UNVERIFIED"]});
    expect(JSON.stringify(report)).not.toContain("private internal database URI");
  });
  it("blocks the same generation and Judge model or invalid official model URL",async()=>{
    const ports=fixture();
    ports.roleStatus=vi.fn(async()=>gen);
    let result=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
    expect(result.blockers).toContain("LAB_GENERATOR_EQUALS_JUDGE");
    ports.roleStatus=vi.fn(async role=>role==="generation"?gen:{
      configured:true,connection:{model:judge.connection.model,baseUrl:"https://bad-provider.example/v1"},
    });
    result=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
    expect(result.blockers).toContain("LAB_SAVED_MODEL_ROUTE_UNSUPPORTED");
  });
  it("blocks absent Judge and route lookup exceptions without leaking keys",async()=>{
    const ports=fixture();
    ports.roleStatus=vi.fn(async role=>{
      if(role==="judge")throw Error("SECRET_INTERNAL_PROVIDER_TOKEN");
      return gen;
    });
    const report=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
    expect(report.blockers).toContain("LAB_INDEPENDENT_JUDGE_UNAVAILABLE");
    expect(report.status).toBe("blocked");
    expect(JSON.stringify(report)).not.toContain("SECRET_INTERNAL_PROVIDER_TOKEN");
  });
  it("stops before any private data query in production or an improperly isolated Lab",async()=>{
    const ports=fixture();
    let report=await inspectLabThreeGenerationReadiness({EVOLUTION_EXPERIMENT_MODE:"production"},ports,now);
    expect(report).toMatchObject({status:"blocked",blockers:["LAB_EXPERIMENT_MODE_REQUIRED"]});
    expect(ports.inspectJobs).not.toHaveBeenCalled();
    ports.inspectIdentity=vi.fn(()=>({ready:false,codes:["LAB_DATA_PLANE_BINDING_MISMATCH"]}));
    report=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
    expect(report.blockers).toContain("LAB_DATA_PLANE_BINDING_MISMATCH");
    expect(ports.inspectJobs).not.toHaveBeenCalled();
    expect(ports.roleStatus).not.toHaveBeenCalled();
    expect(ports.inspectMission).not.toHaveBeenCalled();
  });
  it("uses only injected read-only ports; never fetches MiniMax, creates Mission, or initializes budget",async()=>{
    const network=vi.fn();vi.stubGlobal("fetch",network);
    try{
      const ports=fixture();
      const report=await inspectLabThreeGenerationReadiness(safeEnv,ports,now);
      expect(report.executionAllowed).toBe(false);
      expect(report.providerQuotaChecked).toBe(false);
      expect(network).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });
});
