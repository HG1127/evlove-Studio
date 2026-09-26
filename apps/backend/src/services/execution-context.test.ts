// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {EvolutionJob,EvolveProject,ProductionRuntimePorts} from "@evolution/contracts";
import {buildExecutionContext,ExecutionContextIdentityError} from "./execution-context";
import {prepareHarnessExecution} from "./harness-runner";

const mission={id:"mission-1",campaign:{checkpoint:{round:2}}} as EvolveProject;
const job={id:"job-1",missionId:mission.id} as EvolutionJob;

function runtime(options:{mission?:EvolveProject|null;job?:EvolutionJob|null}={}){
  return {
    missions:{get:vi.fn(async()=>options.mission===null?undefined:options.mission??mission)},
    jobs:{get:vi.fn(async()=>options.job===null?undefined:options.job??job)},
    events:{list:vi.fn(async()=>[]),append:vi.fn(async()=>undefined)},
  } as unknown as ProductionRuntimePorts;
}

describe("Harness execution context",()=>{
  it("prepares the exact bound Job without writing an ActionPlanned Event",async()=>{
    const ports=runtime();
    const result=await prepareHarnessExecution(mission.id,job.id,ports);
    expect(result).toMatchObject({
      action:"harness-context-build",status:"prepared",
      context:{mission,job,checkpoint:mission.campaign.checkpoint,recentEvents:[]},
    });
    expect(ports.events.list).toHaveBeenCalledWith(mission.id,50);
    expect(ports.events.append).not.toHaveBeenCalled();
  });

  it("does not read a Job or Events when the requested Mission is missing or mismatched",async()=>{
    for(const value of [null,{...mission,id:"another-mission"}]){
      const ports=runtime({mission:value});
      await expect(buildExecutionContext(ports,mission.id,job.id))
        .rejects.toMatchObject({name:"ExecutionContextIdentityError",kind:"mission"});
      expect(ports.jobs.get).not.toHaveBeenCalled();
      expect(ports.events.list).not.toHaveBeenCalled();
    }
  });

  it("rejects missing, wrong-ID, and cross-Mission Jobs before reading Events",async()=>{
    for(const value of [null,{...job,id:"another-job"},{...job,missionId:"another-mission"}]){
      const ports=runtime({job:value});
      await expect(buildExecutionContext(ports,mission.id,job.id))
        .rejects.toMatchObject({name:"ExecutionContextIdentityError",kind:"job"});
      expect(ports.events.list).not.toHaveBeenCalled();
      expect(ports.events.append).not.toHaveBeenCalled();
    }
  });

  it("allows Mission-only context preparation without a Job",async()=>{
    const ports=runtime();
    const result=await buildExecutionContext(ports,mission.id);
    expect(result.job).toBeUndefined();
    expect(ports.jobs.get).not.toHaveBeenCalled();
  });

  it("uses a typed identity error for the HTTP route to map to 404",()=>{
    expect(new ExecutionContextIdentityError("job")).toMatchObject({
      name:"ExecutionContextIdentityError",kind:"job",message:"Job not found for Mission",
    });
  });
});
