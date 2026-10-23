import {describe,expect,it,vi} from "vitest";
import {CandidateSchema} from "@evolution/contracts";
import {buildCandidatePopulation} from "./build-candidates";
const candidates=[1,2].map(n=>CandidateSchema.parse({id:`C${n}`,name:`Plan ${n}`,change:"Clarify"}));
describe("per-Candidate checkpoint and progress",()=>{
  it("saves each completed Candidate before starting the next, retaining a later failure",async()=>{
    const order:string[]=[];const progress=vi.fn();
    const result=await buildCandidatePopulation(candidates,{concurrency:1,progress,
      build:async(candidate,detail)=>{order.push("start:"+candidate.id);detail("保存实际文件");if(candidate.id==="C2")throw new Error("model timeout");return {...candidate,artifactBuildStatus:"ready"};},
      checkpoint:candidate=>{order.push("save:"+candidate.id);},
    });
    expect(order).toEqual(["start:C1","save:C1","start:C2","save:C2"]);
    expect(result[0]?.artifactBuildStatus).toBe("ready");
    expect(result[1]?.artifactBuildSummary).toBe("model timeout");
    expect(progress.mock.calls.some(call=>call[0]===1&&call[1]===2)).toBe(true);
    expect(progress.mock.calls.some(call=>String(call[2]).includes("保存实际文件"))).toBe(true);
  });
  it("stops immediately on cancellation instead of building the next Candidate",async()=>{
    const controller=new AbortController();const checkpoint=vi.fn();
    const build=vi.fn(async(candidate)=>{controller.abort();return candidate;});
    await expect(buildCandidatePopulation(candidates,{concurrency:1,signal:controller.signal,build,checkpoint})).rejects.toThrow();
    expect(build).toHaveBeenCalledTimes(1);expect(checkpoint).not.toHaveBeenCalled();
  });
  it("does not accept a foreign build ID",async()=>{
    const result=await buildCandidatePopulation([candidates[0]!],{concurrency:1,build:async()=>({...candidates[1]!})});
    expect(result[0]).toMatchObject({id:"C1",artifactBuildStatus:"failed",artifactBuildSummary:expect.stringContaining("ID 不一致")});
  });
});
