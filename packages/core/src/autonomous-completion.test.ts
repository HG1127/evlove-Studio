import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {completeAutonomousMission} from "./autonomous-completion";

describe("autonomous mission completion",()=>{
  it("settles campaign state and clears the durable round checkpoint",()=>{
    const project={
      targetConnection:{adapter:"artifact"},
      campaign:{status:"running",checkpoint:{round:2,completedPhase:"validation",at:"old"},schedule:{enabled:true,nextRunAt:"later"}},
      gates:[{id:"release-ready",label:"Release",status:"pending"}],
    } as unknown as EvolveProject;
    const done=completeAutonomousMission(project,{at:"2026-09-20T15:00:00Z",reason:"closure complete"});
    expect(done.campaign.status).toBe("completed");
    expect(done.campaign.checkpoint).toBeUndefined();
    expect(done.campaign.schedule.enabled).toBe(false);
    expect(done.campaign.completedAt).toBe("2026-09-20T15:00:00Z");
    expect(done.gates[0]?.status).toBe("approved");
  });
});
