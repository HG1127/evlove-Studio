// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkVercelReleaseHealth,
  executeVercelReleaseAction,
  getVercelReleaseCapabilities,
} from "./vercel-release";

const KEYS=[
  "VERCEL","VERCEL_PROJECT_ID","VERCEL_PROJECT_NAME","VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_RELEASE_TOKEN","EVOLUTION_VERCEL_RELEASE_TOKEN",
] as const;
const previous=new Map<string,string|undefined>();

describe("Vercel release provider",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    process.env.VERCEL="1";
    process.env.VERCEL_PROJECT_ID="prj_test";
    process.env.VERCEL_PROJECT_NAME="evolution-test";
    process.env.VERCEL_PROJECT_PRODUCTION_URL="evolution-test.vercel.app";
  });

  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("is read-only without a dedicated release token",async()=>{
    const caps=await getVercelReleaseCapabilities();
    expect(caps.available).toBe(true);
    expect(caps.readEnabled).toBe(true);
    expect(caps.writeEnabled).toBe(false);
    expect(caps.credentialStatus).toBe("required");
    expect(caps.mode).toBe("preview-promote");
    expect(caps.actions).toEqual([]);
  });

  it("checks production health without Vercel API credentials",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("<html>ok</html>",{status:200})));
    const health=await checkVercelReleaseHealth();
    expect(health.ready).toBe(true);
    expect(health.url).toBe("https://evolution-test.vercel.app");
    expect(health.checks[0]?.status).toBe(200);
  });

  it("retries transient network failures before failing a production gate",async()=>{
    const fetchMock=vi.fn()
      .mockRejectedValueOnce(new Error("edge reset"))
      .mockResolvedValueOnce(new Response("<html>ok</html>",{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    const health=await checkVercelReleaseHealth();
    expect(health.ready).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed before any Vercel write request when release credentials are missing",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeVercelReleaseAction({
      action:"shadow",
      deploymentId:"dpl_preview",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    })).rejects.toMatchObject({code:"VERCEL_RELEASE_CREDENTIAL_REQUIRED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for fake canary stages even with write credentials",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    await expect(executeVercelReleaseAction({
      action:"canary-5",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    })).rejects.toThrow(/Preview → Promote|5\/20\/50|Rolling Release/i);
  });

  it("requires an explicit Preview deployment binding before any write API call",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeVercelReleaseAction({
      action:"shadow",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    })).rejects.toThrow(/显式绑定|deploymentId/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
