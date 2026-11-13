// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";

const {jobs,blobs}=vi.hoisted(()=>({jobs:vi.fn(),blobs:vi.fn()}));
vi.mock("./scheduled-job-reconciliation",async(importOriginal)=>(
  {...await importOriginal<typeof import("./scheduled-job-reconciliation")>(),runScheduledJobReconciliation:jobs}
));
vi.mock("./artifact-blob-cleanup",()=>({cleanupArtifactBlobs:blobs}));
const guard=vi.hoisted(()=>vi.fn());
vi.mock("./lab-reconciliation-preflight",()=>({assertLabReconciliationReady:guard}));
vi.mock("../server-env",async(importOriginal)=>(
  {...await importOriginal<typeof import("../server-env")>(),serverSupabaseSecureConfigured:()=>true}
));

import route from "../../server/api/evolution/jobs/reconcile-scheduled.get";

const priorSecret=process.env.CRON_SECRET;
const priorMode=process.env.EVOLUTION_EXPERIMENT_MODE;
function event(){
  return mockEvent(new Request("http://localhost/api/evolution/jobs/reconcile-scheduled",{
    headers:{authorization:"Bearer test-repair-cron-secret"},
  }));
}

describe("scheduled reconciliation inspection failures",()=>{
  beforeEach(()=>{
    process.env.CRON_SECRET="test-repair-cron-secret";
    process.env.EVOLUTION_EXPERIMENT_MODE="standard";
    guard.mockReset().mockResolvedValue(undefined);
    jobs.mockReset();blobs.mockReset();
    blobs.mockResolvedValue({inspected:0,removed:0,results:[]});
  });
  afterEach(()=>{
    if(priorSecret===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=priorSecret;
    if(priorMode===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
    else process.env.EVOLUTION_EXPERIMENT_MODE=priorMode;
    vi.restoreAllMocks();
  });

  it("checks Lab-wide integrity BEFORE any scheduled mutation or cleanup",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
    guard.mockRejectedValueOnce(new Error("synthetic missing Mission"));
    await expect(route(event())).rejects.toMatchObject({status:503});
    expect(guard).toHaveBeenCalledOnce();
    expect(jobs).not.toHaveBeenCalled();
    expect(blobs).not.toHaveBeenCalled();
  });

  it("allows a clear Lab inventory to precede scheduled reconciliation",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
    jobs.mockResolvedValue({inspected:0,inspectionFailures:0,repairFailures:0,
      orphaned:0,repaired:0,issues:[]});
    await expect(route(event())).resolves.toMatchObject({jobs:{repaired:0}});
    expect(guard).toHaveBeenCalledOnce();
    expect(jobs).toHaveBeenCalledOnce();
    expect(blobs).toHaveBeenCalledOnce();
    expect(guard.mock.invocationCallOrder[0]).toBeLessThan(jobs.mock.invocationCallOrder[0]!);
  });

  it("blocks scheduled side effects when a Job has lost its parent Mission",async()=>{
    jobs.mockResolvedValue({inspected:1,inspectionFailures:0,repairFailures:0,orphaned:1,repaired:0,
      issues:[{jobId:"control-orphan",issue:"mission-missing",repaired:false}]});
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    await expect(route(event())).rejects.toMatchObject({status:503});
    expect(blobs).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Scheduled Job reconciliation found missing Missions",{orphaned:1});
  });

  it("finishes the bounded Artifact scan but reports unresolved Workflow inspection",async()=>{
    jobs.mockResolvedValue({inspected:1,inspectionFailures:1,repairFailures:0,repaired:0,
      issues:[{jobId:"control-1",issue:"inspection-failed",repaired:false}]});
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    await expect(route(event())).rejects.toMatchObject({status:503});
    expect(blobs).toHaveBeenCalledWith({limit:50,minAgeSeconds:900,dryRun:false});
    expect(log).toHaveBeenCalledWith("Scheduled Job reconciliation had inspection failures",{failed:1});
  });

  it("reports a failed Job repair after completing the bounded Artifact scan",async()=>{
    jobs.mockResolvedValue({inspected:1,inspectionFailures:0,repairFailures:1,repaired:0,
      issues:[{jobId:"control-1",issue:"missing-run",repaired:false}]});
    const log=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    await expect(route(event())).rejects.toMatchObject({status:503});
    expect(blobs).toHaveBeenCalledWith({limit:50,minAgeSeconds:900,dryRun:false});
    expect(log).toHaveBeenCalledWith("Scheduled Job reconciliation had repair failures",{failed:1});
  });
});
