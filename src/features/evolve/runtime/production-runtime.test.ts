import {afterEach,describe,expect,it,vi} from "vitest";
import {serverEnv} from "./env";
import {
  getProductionRuntime,
  productionRuntimeMode,
  resetProductionRuntime,
} from "./production-runtime";

const originalApiUrl=serverEnv.EVOLUTION_API_URL;

afterEach(()=>{
  serverEnv.EVOLUTION_API_URL=originalApiUrl;
  vi.unstubAllEnvs();
  resetProductionRuntime();
});

describe("browser Production Runtime lifecycle",()=>{
  it("keeps the auto HTTP adapter stable for the browser session so Mission revision cache survives sync calls",()=>{
    vi.stubEnv("MODE","production");
    serverEnv.EVOLUTION_API_URL="/api/evolution";
    resetProductionRuntime();

    expect(productionRuntimeMode()).toBe("http");
    const first=getProductionRuntime();
    const second=getProductionRuntime();
    expect(second).toBe(first);

    resetProductionRuntime();
    expect(getProductionRuntime()).not.toBe(first);
  });
});
