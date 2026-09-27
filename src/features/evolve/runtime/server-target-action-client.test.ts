import {afterEach,describe,expect,it,vi} from "vitest";
import {runServerGitTargetAction} from "./server-git-client";
import {runServerConnectorAction} from "./server-connector-client";

const at="2026-09-24T00:00:00.000Z";

describe("server Target action clients",()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it("accepts only Git receipts for the requested action and repository",async()=>{
    const request={action:"snapshot" as const,repository:{provider:"github" as const,owner:"team",repo:"product",baseBranch:"main"}};
    const receipt={provider:"github",action:"snapshot",ok:true,repository:"team/product",observedAt:at,note:"snapshot"};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(receipt),{status:200})));
    await expect(runServerGitTargetAction(request)).resolves.toMatchObject(receipt);
    for(const mismatch of [{action:"observe"},{repository:"team/other"}]){
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...receipt,...mismatch}),{status:200})));
      await expect(runServerGitTargetAction(request)).rejects.toThrow("Git Target action receipt identity mismatch");
    }
  });

  it("accepts only Connector receipts for the requested operation and Target",async()=>{
    const request={connectorId:"connector-1",operation:"snapshot" as const,targetId:"target-1",payload:{}};
    const receipt={connectorId:"connector-1",operation:"snapshot",targetId:"target-1",ok:true,observedAt:at,note:"snapshot"};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(receipt),{status:200})));
    await expect(runServerConnectorAction(request)).resolves.toMatchObject(receipt);
    for(const mismatch of [{connectorId:"connector-2"},{operation:"observe"},{targetId:"target-2"}]){
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...receipt,...mismatch}),{status:200})));
      await expect(runServerConnectorAction(request)).rejects.toThrow("Connector action receipt identity mismatch");
    }
  });
});