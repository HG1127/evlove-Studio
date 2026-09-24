// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {EvolutionJobSchema} from "@evolution/contracts";
import route from "../../server/api/evolution/parse-jobs.get";

const mocks=vi.hoisted(()=>({list:vi.fn(),artifacts:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",async(importOriginal)=>({
  ...await importOriginal<typeof import("./production-runtime")>(),
  listRecentServerParseJobs:mocks.list,
}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:mocks.artifacts}));

const at="2026-09-24T00:00:00.000Z";
const completed=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"parse-1",type:"parse",status:"completed",label:"Parse",
  idempotencyKey:"parse-key",generation:1,attempts:1,priority:80,
  outputRef:"result-1",createdAt:at,updatedAt:at,finishedAt:at,
});

afterEach(()=>{
  vi.restoreAllMocks();
  for(const mock of Object.values(mocks))mock.mockReset();
});

describe("Parse recovery listing",()=>{
  it("reports a missing result without rewriting the authoritative completed Job",async()=>{
    mocks.list.mockResolvedValue([completed]);
    mocks.artifacts.mockReturnValue({get:vi.fn(async()=>undefined)});
    const response=await route(mockEvent(new Request("http://localhost/api/evolution/parse-jobs?sessionId=session-1")));
    expect(response.items).toEqual([{job:completed,resultIssue:"Parse 结果 Artifact 缺失"}]);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({limit:60,sessionId:"session-1"}));
  });

  it("distinguishes a transient Artifact read failure from a missing result",async()=>{
    mocks.list.mockResolvedValue([completed]);
    mocks.artifacts.mockReturnValue({get:vi.fn(async()=>{throw new Error("Storage unavailable");})});
    const response=await route(mockEvent(new Request("http://localhost/api/evolution/parse-jobs")));
    expect(response.items[0]).toMatchObject({
      job:{status:"completed"},resultIssue:"Parse 结果 Artifact 暂时不可读取",
    });
  });
});
