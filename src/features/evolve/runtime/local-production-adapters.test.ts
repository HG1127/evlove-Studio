import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "./job-contract";
import {cacheRemoteEvolutionJob,localProductionPorts} from "./local-production-adapters";
import {createParseJob,discardParseJob} from "./parse-job-store";

describe("local production job projection",()=>{
  beforeEach(()=>{window.localStorage.clear();vi.useFakeTimers();});
  afterEach(async()=>{
    await discardParseJob("parse-conflict",{deleteArtifact:false});
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("keeps the newest Job projection across remote generic and specialized local stores",async()=>{
    vi.setSystemTime(new Date("2026-09-22T10:00:00.000Z"));
    await createParseJob({id:"parse-conflict",file:new File(["source"],"source.txt",{type:"text/plain"}),role:"target"});

    const remoteAt="2026-09-22T10:05:00.000Z";
    cacheRemoteEvolutionJob(EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"parse-conflict",type:"parse",status:"completed",label:"Remote completed",
      idempotencyKey:"parse:parse-conflict:2",generation:2,attempts:2,priority:50,metadata:{},
      createdAt:"2026-09-22T10:00:00.000Z",finishedAt:remoteAt,updatedAt:remoteAt,
    }));

    expect(await localProductionPorts.jobs.get("parse-conflict")).toMatchObject({
      status:"completed",generation:2,updatedAt:remoteAt,
    });
  });
});
