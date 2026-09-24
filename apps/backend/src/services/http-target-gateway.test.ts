// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getHttpTargetGatewayCapabilities,observeHttpTarget,releaseHttpTarget,runHttpTarget} from "./http-target-gateway";

const KEYS=["EVOLUTION_TARGET_RUN_URL","EVOLUTION_TARGET_RELEASE_URL","EVOLUTION_TARGET_OBSERVE_URL","EVOLUTION_TARGET_BEARER_TOKEN","EVOLUTION_TARGET_TIMEOUT_MS"] as const;
const previous=new Map<string,string|undefined>();

describe("server HTTP target gateway",()=>{
  beforeEach(()=>{for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}});
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });

  it("is code-ready but fail-closed when no external target endpoint is configured",async()=>{
    expect(getHttpTargetGatewayCapabilities()).toMatchObject({codeReady:true,runConfigured:false,releaseConfigured:false,observeConfigured:false});
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    await expect(runHttpTarget({
      projectId:"p",connectionId:"c",
      testCase:{id:"T1",title:"t",input:"i",expected:[],tags:[],hidden:false,criterionIds:[],executionMode:"external-runner",evidenceScope:"product-behavior"},
      variant:null,
    })).rejects.toMatchObject({code:"TARGET_PROXY_NOT_CONFIGURED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps bearer credentials server-side while proxying a run",async()=>{
    process.env.EVOLUTION_TARGET_RUN_URL="https://runner.internal/run";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="secret-server-token";
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer secret-server-token");
      expect(String(init?.body)).not.toContain("secret-server-token");
      return new Response(JSON.stringify({
        testCaseId:"T1",output:"verified",latencyMs:1,cost:0,verificationStatus:"verified",trace:[],
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await runHttpTarget({
      projectId:"p",connectionId:"c",
      testCase:{id:"T1",title:"t",input:"i",expected:[],tags:[],hidden:false,criterionIds:[],executionMode:"external-runner",evidenceScope:"product-behavior"},
      variant:null,
    });
    expect(result.verificationStatus).toBe("verified");
  });

  it("rejects a Target Run receipt for another Test Case or without an explicit status",async()=>{
    process.env.EVOLUTION_TARGET_RUN_URL="https://runner.internal/run";
    const input={
      projectId:"p",connectionId:"c",
      testCase:{id:"T1",title:"t",input:"i",expected:[],tags:[],hidden:false,criterionIds:[],executionMode:"external-runner" as const,evidenceScope:"product-behavior" as const},
      variant:null,
    };
    const receipt={testCaseId:"T2",output:"wrong test",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(receipt),{status:200})));
    await expect(runHttpTarget(input)).rejects.toThrow("another Test Case");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ...receipt,testCaseId:"T1",verificationStatus:undefined,
    }),{status:200})));
    await expect(runHttpTarget(input)).rejects.toThrow();
  });

  it("accepts verified evidence only for the submitted Artifact bytes",async()=>{
    process.env.EVOLUTION_TARGET_RUN_URL="https://runner.internal/run";
    const content="<!doctype html><title>Exact Artifact</title>";
    const digest=createHash("sha256").update(content).digest("hex");
    const input={
      projectId:"p",connectionId:"c",artifact:{name:"index.html",content},
      testCase:{id:"T1",title:"t",input:"i",expected:[],tags:[],hidden:false,criterionIds:[],executionMode:"external-runner" as const,evidenceScope:"product-behavior" as const},
      variant:null,
    };
    const receipt={testCaseId:"T1",output:"observed",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...receipt,artifactHash:"wrong"}),{status:200})));
    await expect(runHttpTarget(input)).rejects.toThrow("submitted Artifact SHA-256");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...receipt,artifactHash:digest}),{status:200})));
    await expect(runHttpTarget(input)).resolves.toMatchObject({testCaseId:"T1",artifactHash:digest});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ...receipt,verificationStatus:"unverified",artifactHash:undefined,
    }),{status:200})));
    await expect(runHttpTarget(input)).resolves.toMatchObject({verificationStatus:"unverified"});

    const archive=Buffer.from("frozen package bytes");
    const archiveDigest=createHash("sha256").update(archive).digest("hex");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ...receipt,artifactHash:archiveDigest,
    }),{status:200})));
    await expect(runHttpTarget({
      ...input,artifact:undefined,archiveBase64:archive.toString("base64"),
    })).resolves.toMatchObject({artifactHash:archiveDigest});
  });

  it("proxies release with server-only credentials",async()=>{
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://runner.internal/release";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="secret-server-token";
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer secret-server-token");
      return new Response(JSON.stringify({
        ok:true,trafficPercent:100,note:"ok",healthy:true,kpis:[],evidenceMode:"live",observationStatus:"healthy",
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const candidate={
      id:"C1",name:"c",change:"x",patches:[],addressesAdvice:[],riskLevel:"low",risks:[],
      accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS",recommended:true,status:"passed",notes:[],artifactSnapshots:[],
    };
    const result=await releaseHttpTarget({projectId:"p",connectionId:"c",candidate,action:"promote"});
    expect(result.ok).toBe(true);
  });

  it("proxies a read-only observe receipt with strict live release identity",async()=>{
    process.env.EVOLUTION_TARGET_OBSERVE_URL="https://runner.internal/observe";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="secret-server-token";
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer secret-server-token");
      const body=JSON.parse(String(init?.body)) as {candidate:{id:string};recoveryAction?:string;expectedArtifactHashes?:unknown[]};
      expect(body.candidate.id).toBe("C1");
      expect(body.recoveryAction).toBe("promote");
      expect(body.expectedArtifactHashes).toHaveLength(1);
      return new Response(JSON.stringify({
        ok:true,trafficPercent:100,note:"production observed",healthy:true,kpis:[],evidenceMode:"live",
        effectiveAction:"promote",observationStatus:"healthy",deploymentId:"http-candidate",stableDeploymentId:"http-stable",
        artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
        environment:"production",observedAt:"2026-09-22T01:10:00Z",sampleSize:2,windowMinutes:1,
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const candidate={
      id:"C1",name:"c",change:"x",patches:[],addressesAdvice:[],riskLevel:"low",risks:[],
      accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS",recommended:true,status:"passed",notes:[],
      artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now"}],
    };
    const result=await observeHttpTarget({
      projectId:"p",connectionId:"c",candidate,deploymentId:"http-candidate",stableDeploymentId:"http-stable",
      expectedArtifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],recoveryAction:"promote",healthPath:"/",
    });
    expect(result).toMatchObject({evidenceMode:"live",effectiveAction:"promote",deploymentId:"http-candidate"});
  });

  it("rejects an observe response that is successful HTTP but lacks a live deployment receipt",async()=>{
    process.env.EVOLUTION_TARGET_OBSERVE_URL="https://runner.internal/observe";
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ok:true,trafficPercent:100,note:"incomplete",healthy:true,kpis:[],evidenceMode:"simulation",
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    const candidate={
      id:"C1",name:"c",change:"x",patches:[],addressesAdvice:[],riskLevel:"low",risks:[],
      accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS",recommended:true,status:"passed",notes:[],artifactSnapshots:[],
    };
    await expect(observeHttpTarget({projectId:"p",connectionId:"c",candidate,expectedArtifactHashes:[]})).rejects.toThrow();
  });
});
