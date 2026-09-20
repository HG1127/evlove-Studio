// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkVercelReleaseHealth,
  executeVercelReleaseAction,
  getVercelReleaseCapabilities,
  observeVercelReleaseReality,
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

  it("replays promote safely when Production already points at the exact Candidate deployment",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(init?.method==="POST")throw new Error("idempotent replay must not issue another production write");
      if(url.includes("/v13/deployments/evolution-test.vercel.app")){
        return new Response(JSON.stringify({uid:"dpl_preview",url:"candidate.vercel.app",readyState:"READY",target:"production"}),{status:200});
      }
      if(url.includes("/v13/deployments/dpl_preview")){
        return new Response(JSON.stringify({uid:"dpl_preview",url:"candidate.vercel.app",readyState:"READY",target:"production"}),{status:200});
      }
      if(url.startsWith("https://evolution-test.vercel.app"))return new Response("ok",{status:200});
      throw new Error("unexpected URL "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeVercelReleaseAction({
      action:"promote",
      deploymentId:"dpl_preview",
      stableDeploymentId:"dpl_stable",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    });
    expect(result.ok).toBe(true);
    expect(result.stableDeploymentId).toBe("dpl_stable");
    expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
  });

  it("observes Production and bound Preview without any release write",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(init?.method==="POST")throw new Error("observation must be read-only");
      if(url.includes("/v13/deployments/evolution-test.vercel.app")){
        return new Response(JSON.stringify({uid:"dpl_prod",url:"evolution-test.vercel.app",readyState:"READY",target:"production"}),{status:200});
      }
      if(url.includes("/v13/deployments/dpl_preview")){
        return new Response(JSON.stringify({uid:"dpl_preview",url:"candidate.vercel.app",readyState:"READY",target:"preview"}),{status:200});
      }
      if(url.startsWith("https://evolution-test.vercel.app")||url.startsWith("https://candidate.vercel.app")){
        return new Response("ok",{status:200});
      }
      throw new Error("unexpected URL "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await observeVercelReleaseReality({boundDeploymentId:"dpl_preview",healthPath:"/"});
    expect(result.productionDeployment?.id).toBe("dpl_prod");
    expect(result.boundDeployment?.id).toBe("dpl_preview");
    expect(result.productionHealth.ready).toBe(true);
    expect(result.boundHealth?.ready).toBe(true);
    expect(result.errors).toEqual([]);
    expect(fetchMock.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
  });
});
