// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/data-plane-health-scheduled.get";

const {probe}=vi.hoisted(()=>({probe:vi.fn()}));
vi.mock("./data-plane-health",()=>({getDataPlaneHealth:probe}));

const priorSecret=process.env.CRON_SECRET;

function event(token?:string){
  return mockEvent(new Request("http://localhost/api/evolution/data-plane-health-scheduled",{
    headers:token?{authorization:`Bearer ${token}`}:{},
  }));
}

describe("scheduled read-only data-plane health",()=>{
  beforeEach(()=>{
    process.env.CRON_SECRET="test-scheduled-health-secret";
    probe.mockReset();
  });
  afterEach(()=>{
    if(priorSecret===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=priorSecret;
    vi.restoreAllMocks();
  });

  it("rejects requests without the Cron bearer secret before probing",async()=>{
    await expect(route(event())).rejects.toMatchObject({status:401});
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports a real ready probe without mutating Jobs or Artifacts",async()=>{
    const health={status:"ready",database:true,storage:true,artifactCleanup:true,
      tables:{missions:true,jobs:true,events:true,artifacts:true},blockers:[]};
    probe.mockResolvedValue(health);
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    expect(await route(event("test-scheduled-health-secret"))).toEqual(health);
    expect(probe).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith("Scheduled data-plane health",{
      status:"ready",database:true,storage:true,artifactCleanup:true,
      tables:health.tables,blockers:[],
    });
  });

  it("returns 503 for a degraded real probe",async()=>{
    probe.mockResolvedValue({status:"degraded",database:false,storage:true,artifactCleanup:true,
      tables:{missions:false,jobs:false,events:false,artifacts:false},blockers:["Database tables not ready"]});
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    await expect(route(event("test-scheduled-health-secret"))).rejects.toMatchObject({status:503});
  });
});
