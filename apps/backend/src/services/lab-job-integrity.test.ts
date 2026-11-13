// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {inspectLabJobIntegrity,type LabJobIntegrityDependencies} from "./lab-job-integrity";

vi.mock("../isolated-lab-runtime",()=>({inspectIsolatedLabRuntime:()=>({ready:true,codes:[]})}));

const prev=process.env.EVOLUTION_EXPERIMENT_MODE;
const date=new Date("2026-11-13T00:00:00.000Z");
const at=date.toISOString();
const job=(id:string,missionId:string|undefined,status:"waiting"|"running"|"completed"="waiting")=>
  EvolutionJobSchema.parse({schemaVersion:"job-v1",id,missionId,type:"campaign",
    label:"Lab integrity fixture",status,idempotencyKey:"workflow-control:"+id,generation:1,
    attempts:1,priority:70,createdAt:at,updatedAt:at});
function deps(jobs:ReturnType<typeof job>[],hasMission:(id:string)=>Promise<boolean>):LabJobIntegrityDependencies{
  return {listJobs:vi.fn(async()=>jobs),hasMission:vi.fn(hasMission)};
}
beforeEach(()=>{process.env.EVOLUTION_EXPERIMENT_MODE="isolated";});
afterEach(()=>{
  if(prev===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
  else process.env.EVOLUTION_EXPERIMENT_MODE=prev;
});
describe("P3-O Lab Mission/Job link integrity audit",()=>{
  it("identifies both missing parent Mission links without cancelling or mutating a Job",async()=>{
    const j=[job("campaign-old","missing-mission"),job("discovery-old","missing-mission")];
    const ports=deps(j,async()=>false);
    const result=await inspectLabJobIntegrity(ports,date);
    expect(result).toMatchObject({mode:"read-only",status:"blocked",reason:"orphan-active-job",
      inspectedJobs:2,activeMissionBoundJobs:2,referencedMissions:1,
      issues:[
        {jobId:"campaign-old",missionId:"missing-mission",reason:"mission-missing",jobStatus:"waiting"},
        {jobId:"discovery-old",missionId:"missing-mission",reason:"mission-missing",jobStatus:"waiting"},
      ]});
    expect(ports.hasMission).toHaveBeenCalledOnce();
    expect(ports.listJobs).toHaveBeenCalledOnce();
    expect(j.every(x=>x.status==="waiting")).toBe(true);
  });
  it("passes when every active Mission-bound Job has a parent, ignoring completed historical jobs",async()=>{
    const ports=deps([job("healthy","mission-a"),job("history","missing", "completed")],async id=>id==="mission-a");
    const result=await inspectLabJobIntegrity(ports,date);
    expect(result).toMatchObject({status:"clear",reason:"no-orphans",issues:[],activeMissionBoundJobs:1});
    expect(ports.hasMission).toHaveBeenCalledOnce();
  });
  it("treats a failed Mission lookup as unknown rather than a false clean result",async()=>{
    const ports=deps([job("old","absent")],async()=>{throw new Error("secret internal DB URL");});
    const result=await inspectLabJobIntegrity(ports,date);
    expect(result).toMatchObject({status:"unknown",reason:"mission-lookup-unavailable",
      issues:[{jobId:"old",reason:"mission-lookup-failed"}]});
    expect(JSON.stringify(result)).not.toContain("secret internal DB URL");
  });
  it("fails closed rather than incorrectly claiming a partial scan is clean",async()=>{
    const jobs=Array.from({length:101},(_,i)=>job("job-"+i,"mission-a"));
    const ports=deps(jobs,async()=>true);
    const result=await inspectLabJobIntegrity(ports,date);
    expect(result).toMatchObject({status:"unknown",reason:"inventory-too-large",issues:[]});
    expect(ports.hasMission).not.toHaveBeenCalled();
  });
  it("never inspects an unrestricted production deployment",async()=>{
    delete process.env.EVOLUTION_EXPERIMENT_MODE;
    const ports=deps([job("old","absent")],async()=>false);
    await expect(inspectLabJobIntegrity(ports,date)).rejects.toMatchObject({code:"LAB_INTEGRITY_NOT_ISOLATED"});
    expect(ports.listJobs).not.toHaveBeenCalled();
  });
});
