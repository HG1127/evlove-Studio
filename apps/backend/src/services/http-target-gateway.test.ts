// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getHttpTargetGatewayCapabilities,releaseHttpTarget,runHttpTarget} from "./http-target-gateway";

const KEYS=["EVOLUTION_TARGET_RUN_URL","EVOLUTION_TARGET_RELEASE_URL","EVOLUTION_TARGET_BEARER_TOKEN","EVOLUTION_TARGET_TIMEOUT_MS"] as const;
const previous=new Map<string,string|undefined>();

describe("server HTTP target gateway",()=>{
  beforeEach(()=>{for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}});
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });

  it("is code-ready but fail-closed when no external target endpoint is configured",async()=>{
    expect(getHttpTargetGatewayCapabilities()).toMatchObject({codeReady:true,runConfigured:false,releaseConfigured:false});
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
});
