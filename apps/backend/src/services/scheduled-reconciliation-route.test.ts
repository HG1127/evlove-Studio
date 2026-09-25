// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";

const {jobs,blobs}=vi.hoisted(()=>({jobs:vi.fn(),blobs:vi.fn()}));
vi.mock("./scheduled-job-reconciliation",async(importOriginal)=>(
  {...await importOriginal<typeof import("./scheduled-job-reconciliation")>(),runScheduledJobReconciliation:jobs}
));
vi.mock("./artifact-blob-cleanup",()=>({cleanupArtifactBlobs:blobs}));
vi.mock("../server-env",async(importOriginal)=>(
  {...await importOriginal<typeof import("../server-env")>(),serverSupabaseSecureConfigured:()=>true}
));

import route from "../../server/api/evolution/jobs/reconcile-scheduled.get";

const priorSecret=process.env.CRON_SECRET;
function event(){
  return mockEvent(new Request("http://localhost/api/evolution/jobs/reconcile-scheduled",{
    headers:{authorization:"Bearer test-repair-cron-secret"},
  }));
}

describe("scheduled reconciliation inspection failures",()=>{
  beforeEach(()=>{
    process.env.CRON_SECRET="test-repair-cron-secret";
    jobs.mockReset();blobs.mockReset();
    blobs.mockResolvedValue({inspected:0,removed:0,results:[]});
  });
  afterEach(()=>{
    if(priorSecret===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=priorSecret;
    vi.restoreAllMocks();
  });

  it("finishes the bounded Artifact scan but reports unresolved Workflow inspection",async()=>{
    jobs.mockResolvedValue({inspected:1,inspectionFailures:1,repaired:0,
      issues:[{jobId:"control-1",issue:"inspection-failed",repaired:false}]});
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    await expect(route(event())).rejects.toMatchObject({status:503});
    expect(blobs).toHaveBeenCalledWith({limit:50,minAgeSeconds:900,dryRun:false});
    expect(log).toHaveBeenCalledWith("Scheduled Job reconciliation had inspection failures",{failed:1});
  });
});
