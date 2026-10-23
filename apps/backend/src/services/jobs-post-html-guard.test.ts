// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";

const mocks=vi.hoisted(()=>({
  mission:vi.fn(),create:vi.fn(),jobGet:vi.fn(),jobPut:vi.fn(),
  permission:vi.fn(),dataPlane:vi.fn(),
}));
vi.mock("./production-runtime",()=>({
  getServerProductionRuntime:()=>({
    missions:{get:mocks.mission},jobs:{get:mocks.jobGet,put:mocks.jobPut},
  }),
  createServerJobIdempotent:mocks.create,
  JobStateConflictError:class extends Error{},
}));
vi.mock("./security-policy",()=>({
  requireGovernedEvolutionPermission:mocks.permission,
}));
vi.mock("./data-plane-guard",()=>({
  requireServerDataPlaneAvailable:mocks.dataPlane,
}));
import jobsPost from "../../server/api/evolution/jobs.post";
import jobsPut from "../../server/api/evolution/jobs/[id].put";

function post(type:"campaign"|"parse",missionId="html-audit"){
  return mockEvent(new Request("http://localhost/api/evolution/jobs",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({
      idempotencyKey:"direct-job-creation",missionId,type,label:"test job",priority:70,
    }),
  }));
}
function put(){
  const id="job-existing";
  const event=mockEvent(new Request("http://localhost/api/evolution/jobs/"+id,{
    method:"PUT",headers:{"content-type":"application/json"},
    body:JSON.stringify({schemaVersion:"job-v1",id,missionId:"html-audit",
      type:"campaign",status:"queued",label:"existing campaign",
      idempotencyKey:"workflow-control:html-audit:existing",generation:1,
      attempts:0,priority:70,createdAt:"2026-10-21T00:00:00Z",
      updatedAt:"2026-10-21T00:00:00Z"}),
  }));
  event.context.params={id};
  return event;
}
function target(extension="html",adapter="artifact",connectionId="upload"){
  return {
    sourceArtifacts:[{id:"source",role:"target",extension}],
    targetConnection:{adapter,connectionId,status:"connected",label:"Test Source"},
  };
}
beforeEach(()=>{
  for(const value of Object.values(mocks))value.mockReset();
  mocks.permission.mockResolvedValue(undefined);
  mocks.dataPlane.mockReturnValue(undefined);
  mocks.create.mockImplementation(async(job:unknown)=>job);
});
describe("generic Job API cannot bypass HTML Campaign atomic control",()=>{
  it("rejects a direct queued Campaign for an uploaded HTML Mission",async()=>{
    mocks.mission.mockResolvedValue(target());
    await expect(jobsPost(post("campaign"))).rejects.toMatchObject({
      statusCode:409,statusMessage:expect.stringContaining("/api/evolution/start"),
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("also protects an old HTML Target incorrectly auto-bound to the generic runner",async()=>{
    mocks.mission.mockResolvedValue(target("htm","http","runner-gateway"));
    await expect(jobsPost(post("campaign"))).rejects.toMatchObject({statusCode:409});
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("preserves a legitimate Parse Job for that same HTML Mission",async()=>{
    mocks.mission.mockResolvedValue(target());
    const result=await jobsPost(post("parse"));
    expect(result).toMatchObject({type:"parse",missionId:"html-audit",status:"queued"});
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("preserves non-HTML Campaign Job creation",async()=>{
    mocks.mission.mockResolvedValue(target("md"));
    const result=await jobsPost(post("campaign"));
    expect(result).toMatchObject({type:"campaign",status:"queued"});
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("disallows creation of a new HTML Campaign via generic Job PUT",async()=>{
    mocks.mission.mockResolvedValue(target());
    mocks.jobGet.mockResolvedValue(undefined);
    await expect(jobsPut(put())).rejects.toMatchObject({statusCode:409,
      statusMessage:expect.stringContaining("/api/evolution/start")});
    expect(mocks.jobPut).not.toHaveBeenCalled();
  });
  it("allows updates to an existing HTML Campaign Job without creating a new one",async()=>{
    mocks.mission.mockResolvedValue(target());
    mocks.jobGet.mockResolvedValue({id:"job-existing",type:"campaign",status:"running"});
    mocks.jobPut.mockResolvedValue(undefined);
    await expect(jobsPut(put())).resolves.toEqual({ok:true,jobId:"job-existing"});
    expect(mocks.jobGet).toHaveBeenCalledWith("job-existing");
    expect(mocks.jobPut).toHaveBeenCalledOnce();
  });
  it("rejects a missing Mission before creating any Job",async()=>{
    mocks.mission.mockResolvedValue(undefined);
    await expect(jobsPost(post("campaign"))).rejects.toMatchObject({statusCode:404});
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
