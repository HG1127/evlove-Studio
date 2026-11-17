// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {serverAiTimeoutMs} from "../server-env";

afterEach(()=>vi.unstubAllEnvs());

describe("P3-X Lab-only bounded provider timeout setting",()=>{
  it("retains the unchanged 90 second default without a Preview override",()=>{
    vi.stubEnv("EVOLUTION_AI_TIMEOUT_MS",undefined);
    vi.stubEnv("OPENAI_TIMEOUT_MS",undefined);
    expect(serverAiTimeoutMs()).toBe(90_000);
  });
  it("accepts an explicit 150 second Preview value, below the 20 minute Mission wall clock",()=>{
    vi.stubEnv("OPENAI_TIMEOUT_MS",undefined);
    vi.stubEnv("EVOLUTION_AI_TIMEOUT_MS","150000");
    expect(serverAiTimeoutMs()).toBe(150_000);
  });
  it("bounds malformed and extreme values without creating unbounded calls",()=>{
    vi.stubEnv("OPENAI_TIMEOUT_MS",undefined);
    vi.stubEnv("EVOLUTION_AI_TIMEOUT_MS","999999999");
    expect(serverAiTimeoutMs()).toBe(300_000);
    vi.stubEnv("EVOLUTION_AI_TIMEOUT_MS","1000");
    expect(serverAiTimeoutMs()).toBe(10_000);
    vi.stubEnv("EVOLUTION_AI_TIMEOUT_MS","garbage");
    expect(serverAiTimeoutMs()).toBe(90_000);
  });
});
