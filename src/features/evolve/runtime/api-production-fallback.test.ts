// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {runDemoAi} from "../ai/demo-provider";
import {localProductionPorts} from "./local-production-adapters";
import {configureProductionRuntime,resetProductionRuntime} from "./production-runtime";

const mocks=vi.hoisted(()=>({
  serverAi:vi.fn(),
  serverIngest:vi.fn(),
}));

vi.mock("./server-ai-client",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("./server-ai-client")>();
  return {...actual,runServerAiOperation:mocks.serverAi};
});

vi.mock("./server-source-client",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("./server-source-client")>();
  return {...actual,ingestSourcesOnServer:mocks.serverIngest};
});

import {runIntake} from "./api";
import {ServerParseUnavailableError} from "./server-source-client";

describe("Production intake fallback truthfulness",()=>{
  beforeEach(()=>{
    window.localStorage.clear();
    configureProductionRuntime(localProductionPorts,"http");
    mocks.serverAi.mockReset();
    mocks.serverIngest.mockReset();
  });

  afterEach(()=>{
    resetProductionRuntime();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("falls back only for parsing, then returns to Server AI instead of Demo AI",async()=>{
    mocks.serverIngest.mockRejectedValue(new ServerParseUnavailableError("server data plane unavailable"));
    mocks.serverAi.mockImplementation(async(operation,payload)=>{
      expect(operation).toBe("intake");
      const input=payload as {artifacts?:Array<{textExcerpt?:string}>};
      expect(input.artifacts?.[0]?.textExcerpt).toContain("真实输入材料");
      return runDemoAi("intake",payload);
    });

    const form=new FormData();
    form.set("command","基于真实输入生成验收目标");
    form.set("pastedText","真实输入材料：关键结论必须有证据。");

    const result=await runIntake(form);

    expect(mocks.serverIngest).toHaveBeenCalledTimes(1);
    expect(mocks.serverAi).toHaveBeenCalledTimes(1);
    expect(result.provider).toEqual({provider:"server-ai",live:true,model:"server"});
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.parseStatus).toBe("ready");
  });
});
