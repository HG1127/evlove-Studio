// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/data-plane-health-scheduled.get";

const {probe,restRead,parseRead}=vi.hoisted(()=>({probe:vi.fn(),restRead:vi.fn(),parseRead:vi.fn()}));
vi.mock("./data-plane-health",()=>({getDataPlaneHealth:probe}));
vi.mock("./production-runtime",async(importOriginal)=>({
  ...await importOriginal<typeof import("./production-runtime")>(),
  getServerJobByIdempotencyKey:restRead,
  listRecentServerParseJobs:parseRead,
}));

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
    restRead.mockReset();
    parseRead.mockReset();
  });
  afterEach(()=>{
    if(priorSecret===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=priorSecret;
    vi.restoreAllMocks();
  });

  it("rejects requests without the Cron bearer secret before probing",async()=>{
    await expect(route(event())).rejects.toMatchObject({status:401});
    expect(probe).not.toHaveBeenCalled();
    expect(restRead).not.toHaveBeenCalled();
    expect(parseRead).not.toHaveBeenCalled();
  });

  it("reports a real ready probe without mutating Jobs or Artifacts",async()=>{
    const health={status:"ready",database:true,storage:true,artifactCleanup:true,
      tables:{missions:true,jobs:true,events:true,artifacts:true},blockers:[]};
    probe.mockResolvedValue(health);
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    expect(await route(event("test-scheduled-health-secret"))).toEqual(health);
    expect(probe).toHaveBeenCalledOnce();
    expect(restRead).toHaveBeenCalledWith("health-probe:no-such-job");
    expect(parseRead).toHaveBeenCalledWith(expect.objectContaining({limit:1,sessionId:"health-probe"}));
    expect(console.info).toHaveBeenCalledWith("Scheduled data-plane health",{
      status:"ready",database:true,storage:true,artifactCleanup:true,
      tables:health.tables,blockers:[],directRestJobs:true,parseRecoveryQuery:true,
    });
  });

  it("returns 503 for a degraded real probe",async()=>{
    probe.mockResolvedValue({status:"degraded",database:false,storage:true,artifactCleanup:true,
      tables:{missions:false,jobs:false,events:false,artifacts:false},blockers:["Database tables not ready"]});
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    await expect(route(event("test-scheduled-health-secret"))).rejects.toMatchObject({status:503});
    expect(restRead).not.toHaveBeenCalled();
    expect(parseRead).not.toHaveBeenCalled();
  });

  it("fails the probe when the direct REST Job query is rejected",async()=>{
    probe.mockResolvedValue({status:"ready",database:true,storage:true,artifactCleanup:true,
      tables:{missions:true,jobs:true,events:true,artifacts:true},blockers:[]});
    restRead.mockRejectedValue({data:{reason:"credential-rejected",upstreamStatus:401,token:"private"}});
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    await expect(route(event("test-scheduled-health-secret"))).rejects.toMatchObject({status:503});
    expect(console.info).toHaveBeenCalledWith("Scheduled data-plane health",expect.objectContaining({
      directRestJobs:false,parseRecoveryQuery:false,
      restFailure:{reason:"credential-rejected",upstreamStatus:401},
    }));
  });

  it("fails the probe when the Parse recovery REST filter is rejected",async()=>{
    probe.mockResolvedValue({status:"ready",database:true,storage:true,artifactCleanup:true,
      tables:{missions:true,jobs:true,events:true,artifacts:true},blockers:[]});
    parseRead.mockRejectedValue({data:{reason:"request-rejected",upstreamStatus:400}});
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    await expect(route(event("test-scheduled-health-secret"))).rejects.toMatchObject({status:503});
    expect(console.info).toHaveBeenCalledWith("Scheduled data-plane health",expect.objectContaining({
      directRestJobs:true,parseRecoveryQuery:false,
      restFailure:{reason:"request-rejected",upstreamStatus:400},
    }));
  });
});
