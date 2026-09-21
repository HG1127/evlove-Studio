// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkVercelReleaseHealth,
  executeVercelReleaseAction,
  findVercelPreviewDeploymentByGitCommit,
  getVercelReleaseCapabilities,
  observeVercelReleaseReality,
} from "./vercel-release";

const KEYS=[
  "VERCEL","VERCEL_PROJECT_ID","VERCEL_PROJECT_NAME","VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_RELEASE_TOKEN","EVOLUTION_VERCEL_RELEASE_TOKEN",
] as const;
const previous=new Map<string,string|undefined>();
const rollingConfig={
  rollingRelease:{
    enabled:true,
    advancementType:"manual-approval",
    stages:[
      {targetPercentage:5},
      {targetPercentage:20},
      {targetPercentage:50},
      {targetPercentage:100},
    ],
  },
};

function json(value:unknown){
  return new Response(JSON.stringify(value),{status:200,headers:{"Content-Type":"application/json"}});
}

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

  it("keeps Preview → Promote when Rolling Release is not configured",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/rolling-release/billing"))return json({availableSlots:1});
      if(url.endsWith("/rolling-release/config"))return json({rollingRelease:null});
      throw new Error("unexpected URL "+url);
    }));
    const caps=await getVercelReleaseCapabilities();
    expect(caps.mode).toBe("preview-promote");
    expect(caps.rollingReleaseSupported).toBe(true);
    expect(caps.rollingReleaseConfigured).toBe(false);
    expect(caps.actions).toEqual(["shadow","promote","rollback"]);
  });

  it("enables progressive actions only for manual 5/20/50/100 Rolling Release config",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/rolling-release/billing"))return json({availableSlots:1});
      if(url.endsWith("/rolling-release/config"))return json(rollingConfig);
      throw new Error("unexpected URL "+url);
    }));
    const caps=await getVercelReleaseCapabilities();
    expect(caps.mode).toBe("progressive");
    expect(caps.rollingReleaseConfigured).toBe(true);
    expect(caps.rollingReleaseStages).toEqual([5,20,50,100]);
    expect(caps.actions).toEqual(["shadow","canary-5","canary-20","canary-50","promote","rollback"]);
  });

  it("discovers exactly one non-production Preview by exact Git commit SHA",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/v6/deployments?")){
        return json({deployments:[
          {uid:"dpl_prod",url:"prod.vercel.app",readyState:"READY",target:"production",meta:{githubCommitSha:"sha-exact"}},
          {uid:"dpl_preview",url:"preview.vercel.app",readyState:"READY",target:"preview",meta:{githubCommitSha:"sha-exact"}},
          {uid:"dpl_other",url:"other.vercel.app",readyState:"READY",target:"preview",meta:{githubCommitSha:"sha-other"}},
        ]});
      }
      throw new Error("unexpected URL "+url);
    }));
    const found=await findVercelPreviewDeploymentByGitCommit("sha-exact");
    expect(found.status).toBe("ready");
    expect(found.deployment?.id).toBe("dpl_preview");
    expect(found.matches).toHaveLength(1);
  });

  it("returns pending for the unique exact-SHA Preview while Vercel is still building",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/v6/deployments?")){
        return json({deployments:[
          {uid:"dpl_preview",url:"preview.vercel.app",readyState:"BUILDING",target:"preview",meta:{githubCommitSha:"sha-exact"}},
        ]});
      }
      throw new Error("unexpected URL "+url);
    }));
    const found=await findVercelPreviewDeploymentByGitCommit("sha-exact");
    expect(found).toMatchObject({status:"pending",deployment:{id:"dpl_preview",state:"BUILDING"}});
  });

  it("fails closed when one exact Git SHA maps to multiple non-production Deployments",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/v6/deployments?")){
        return json({deployments:[
          {uid:"dpl_a",url:"a.vercel.app",readyState:"READY",target:"preview",meta:{githubCommitSha:"sha-exact"}},
          {uid:"dpl_b",url:"b.vercel.app",readyState:"READY",target:"preview",meta:{githubCommitSha:"sha-exact"}},
        ]});
      }
      throw new Error("unexpected URL "+url);
    }));
    const found=await findVercelPreviewDeploymentByGitCommit("sha-exact");
    expect(found.status).toBe("conflict");
    expect(found.matches.map((item)=>item.id)).toEqual(["dpl_a","dpl_b"]);
  });

  it("rejects a manually bound Preview before Shadow when its Git SHA differs from the Mission exact commit",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    const fetchMock=vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.includes("/v13/deployments/evolution-test.vercel.app")){
        return json({uid:"dpl_stable",url:"stable.vercel.app",readyState:"READY",target:"production"});
      }
      if(url.endsWith("/rolling-release/config"))return json({rollingRelease:null});
      if(url.includes("/v13/deployments/dpl_preview")){
        return json({
          uid:"dpl_preview",
          url:"candidate.vercel.app",
          readyState:"READY",
          target:"preview",
          meta:{githubCommitSha:"sha-wrong"},
        });
      }
      if(url.startsWith("https://candidate.vercel.app")){
        throw new Error("Git mismatch must be rejected before Preview Health");
      }
      throw new Error("unexpected URL "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeVercelReleaseAction({
      action:"shadow",
      deploymentId:"dpl_preview",
      expectedGitCommitSha:"sha-exact",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    })).rejects.toMatchObject({code:"VERCEL_RELEASE_GIT_COMMIT_MISMATCH"});
    expect(fetchMock.mock.calls.some(([input])=>String(input).startsWith("https://candidate.vercel.app"))).toBe(false);
  });

  it("starts a real 5% Rolling Release and binds the returned stable/canary identities",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    const writes:Array<{url:string;body?:string}>=[];
    let active=false;
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rolling-release/config"))return json(rollingConfig);
      if(url.endsWith("/rolling-release")&&(!init?.method||init.method==="GET")){
        return json(active?{
          rollingRelease:{
            currentDeployment:{id:"dpl_stable"},
            canaryDeployment:{id:"dpl_preview"},
            currentStageIndex:0,
          },
        }:{rollingRelease:null});
      }
      if(url.endsWith("/rolling-release/start")&&init?.method==="POST"){
        writes.push({url,body:String(init.body)});
        active=true;
        return json({ok:true});
      }
      if(url.includes("/v13/deployments/evolution-test.vercel.app"))return json({uid:"dpl_stable",url:"stable.vercel.app",readyState:"READY",target:"production"});
      if(url.includes("/v13/deployments/dpl_preview"))return json({uid:"dpl_preview",url:"candidate.vercel.app",readyState:"READY",target:"preview"});
      if(url.startsWith("https://candidate.vercel.app"))return new Response("ok",{status:200});
      throw new Error("unexpected URL "+url);
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeVercelReleaseAction({
      action:"canary-5",
      deploymentId:"dpl_preview",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    });
    expect(JSON.parse(writes[0]!.body!)).toEqual({deploymentId:"dpl_preview"});
    expect(result).toMatchObject({
      ok:true,
      trafficPercent:5,
      stableDeploymentId:"dpl_stable",
      deploymentId:"dpl_preview",
      releaseMode:"progressive",
      rollingRelease:{active:true,currentPercentage:5,currentStageIndex:0},
    });
  });

  it("approves the exact current Rolling Release stage before advancing 5% to 20%",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    let stage=0;
    const writes:Array<{url:string;body?:string}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rolling-release/config"))return json(rollingConfig);
      if(url.endsWith("/rolling-release")&&(!init?.method||init.method==="GET"))return json({
        rollingRelease:{
          currentDeployment:{id:"dpl_stable"},
          canaryDeployment:{id:"dpl_preview"},
          currentStageIndex:stage,
        },
      });
      if(url.endsWith("/rolling-release/approve-stage")&&init?.method==="POST"){
        writes.push({url,body:String(init.body)});
        stage=1;
        return json({ok:true});
      }
      if(url.includes("/v13/deployments/evolution-test.vercel.app"))return json({uid:"dpl_stable",url:"stable.vercel.app",readyState:"READY",target:"production"});
      if(url.includes("/v13/deployments/dpl_preview"))return json({uid:"dpl_preview",url:"candidate.vercel.app",readyState:"READY",target:"preview"});
      if(url.startsWith("https://candidate.vercel.app"))return new Response("ok",{status:200});
      throw new Error("unexpected URL "+url);
    }));
    const result=await executeVercelReleaseAction({
      action:"canary-20",
      deploymentId:"dpl_preview",
      stableDeploymentId:"dpl_stable",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    });
    expect(JSON.parse(writes[0]!.body!)).toEqual({deploymentId:"dpl_preview",currentStageIndex:0});
    expect(result.trafficPercent).toBe(20);
    expect(result.rollingRelease?.currentStageIndex).toBe(1);
  });

  it("completes an active 50% Rolling Release and confirms Production on the candidate",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    let active=true;
    let promoted=false;
    const writes:Array<{url:string;body?:string}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rolling-release/config"))return json(rollingConfig);
      if(url.endsWith("/rolling-release")&&(!init?.method||init.method==="GET")){
        return json(active?{
          rollingRelease:{
            currentDeployment:{id:"dpl_stable"},
            canaryDeployment:{id:"dpl_preview"},
            currentStageIndex:2,
          },
        }:{rollingRelease:null});
      }
      if(url.endsWith("/rolling-release/complete")&&init?.method==="POST"){
        writes.push({url,body:String(init.body)});
        active=false;
        promoted=true;
        return json({ok:true});
      }
      if(url.includes("/v13/deployments/evolution-test.vercel.app")){
        return json(promoted
          ?{uid:"dpl_preview",url:"candidate.vercel.app",readyState:"READY",target:"production"}
          :{uid:"dpl_stable",url:"stable.vercel.app",readyState:"READY",target:"production"});
      }
      if(url.includes("/v13/deployments/dpl_preview"))return json({uid:"dpl_preview",url:"candidate.vercel.app",readyState:"READY",target:"preview"});
      if(url.startsWith("https://evolution-test.vercel.app"))return new Response("ok",{status:200});
      throw new Error("unexpected URL "+url);
    }));
    const result=await executeVercelReleaseAction({
      action:"promote",
      deploymentId:"dpl_preview",
      stableDeploymentId:"dpl_stable",
      artifactHashes:[{sourceArtifactId:"source-1",contentHash:"a".repeat(64)}],
    });
    expect(JSON.parse(writes[0]!.body!)).toEqual({deploymentId:"dpl_preview"});
    expect(result).toMatchObject({
      ok:true,
      trafficPercent:100,
      deploymentId:"dpl_preview",
      stableDeploymentId:"dpl_stable",
      releaseMode:"progressive",
      rollingRelease:{active:false},
    });
  });

  it("aborts an active Rolling Release using the canary identity and returns to stable",async()=>{
    process.env.VERCEL_RELEASE_TOKEN="test_release_token";
    let active=true;
    const writes:Array<{url:string;body?:string}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      if(url.endsWith("/rolling-release/config"))return json(rollingConfig);
      if(url.endsWith("/rolling-release")&&(!init?.method||init.method==="GET")){
        return json(active?{
          rollingRelease:{
            currentDeployment:{id:"dpl_stable"},
            canaryDeployment:{id:"dpl_preview"},
            currentStageIndex:1,
          },
        }:{rollingRelease:null});
      }
      if(url.endsWith("/rolling-release/abort")&&init?.method==="POST"){
        writes.push({url,body:String(init.body)});
        active=false;
        return json({ok:true});
      }
      if(url.includes("/v13/deployments/evolution-test.vercel.app"))return json({uid:"dpl_stable",url:"stable.vercel.app",readyState:"READY",target:"production"});
      if(url.includes("/v13/deployments/dpl_stable"))return json({uid:"dpl_stable",url:"stable.vercel.app",readyState:"READY",target:"production"});
      if(url.startsWith("https://evolution-test.vercel.app"))return new Response("ok",{status:200});
      throw new Error("unexpected URL "+url);
    }));
    const result=await executeVercelReleaseAction({
      action:"rollback",
      deploymentId:"dpl_stable",
      stableDeploymentId:"dpl_stable",
      artifactHashes:[],
    });
    expect(JSON.parse(writes[0]!.body!)).toEqual({deploymentId:"dpl_preview"});
    expect(result).toMatchObject({
      ok:true,
      trafficPercent:0,
      deploymentId:"dpl_stable",
      stableDeploymentId:"dpl_stable",
      releaseMode:"progressive",
      rollingRelease:{active:false},
    });
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
      if(url.endsWith("/rolling-release/config"))return json({rollingRelease:null});
      if(url.endsWith("/rolling-release"))return json({rollingRelease:null});
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
      if(url.endsWith("/rolling-release/config"))return json({rollingRelease:null});
      if(url.endsWith("/rolling-release"))return json({rollingRelease:null});
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
