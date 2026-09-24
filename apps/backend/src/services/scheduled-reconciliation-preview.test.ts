// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/jobs/reconcile-preview-scheduled.get";

const {jobs,blobs}=vi.hoisted(()=>({jobs:vi.fn(),blobs:vi.fn()}));
vi.mock("./job-reconciliation",()=>({reconcileWorkflowJobs:jobs}));
vi.mock("./artifact-blob-cleanup",()=>({cleanupArtifactBlobs:blobs}));

const priorSecret=process.env.CRON_SECRET;

function event(token?:string){
  return mockEvent(new Request("http://localhost/api/evolution/jobs/reconcile-preview-scheduled",{
    headers:token?{authorization:`Bearer ${token}`}:{},
  }));
}

describe("scheduled reconciliation preview",()=>{
  beforeEach(()=>{
    process.env.CRON_SECRET="test-preview-cron-secret";
    jobs.mockReset();blobs.mockReset();
    jobs.mockResolvedValue({checkedAt:"2026-09-24T00:00:00.000Z",inspected:0,issues:[],repaired:0});
    blobs.mockResolvedValue({checkedAt:"2026-09-24T00:00:00.000Z",inspected:0,removed:0,results:[]});
  });
  afterEach(()=>{
    if(priorSecret===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=priorSecret;
    vi.restoreAllMocks();
  });

  it("rejects anonymous callers before inspecting production data",async()=>{
    await expect(route(event())).rejects.toMatchObject({status:401});
    expect(jobs).not.toHaveBeenCalled();
    expect(blobs).not.toHaveBeenCalled();
  });

  it("inspects Jobs and tombstones with all mutations disabled",async()=>{
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    const response=await route(event("test-preview-cron-secret"));
    expect(jobs).toHaveBeenCalledWith({minAgeSeconds:900,limit:50,repair:false});
    expect(blobs).toHaveBeenCalledWith({limit:50,minAgeSeconds:900,dryRun:true});
    expect(response.jobs.repaired).toBe(0);
    expect(response.artifactBlobs.removed).toBe(0);
  });

  it("surfaces a failed dry-run item as a degraded Cron result",async()=>{
    blobs.mockResolvedValue({checkedAt:"2026-09-24T00:00:00.000Z",inspected:1,removed:0,
      results:[{artifactId:"scratch-1",status:"failed"}]});
    vi.spyOn(console,"info").mockImplementation(()=>undefined);
    await expect(route(event("test-preview-cron-secret"))).rejects.toMatchObject({status:503});
  });

  it("identifies a failed Job inspection without starting Artifact inspection",async()=>{
    jobs.mockRejectedValue({data:{reason:"credential-rejected",upstreamStatus:401,service:"production-runtime"}});
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    await expect(route(event("test-preview-cron-secret"))).rejects.toMatchObject({status:503});
    expect(log).toHaveBeenCalledWith("Scheduled Job preview failed",{
      reason:"credential-rejected",upstreamStatus:401,service:"production-runtime",
    });
    expect(blobs).not.toHaveBeenCalled();
  });

  it("identifies a failed Artifact inspection after Job inspection",async()=>{
    blobs.mockRejectedValue(new Error("private diagnostic"));
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    await expect(route(event("test-preview-cron-secret"))).rejects.toMatchObject({status:503});
    expect(log).toHaveBeenCalledWith("Scheduled Artifact preview failed",{reason:"unclassified"});
  });
});
