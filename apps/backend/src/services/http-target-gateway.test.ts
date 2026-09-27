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

  it("checks generic file bytes and Candidate identity before accepting a Runner verdict",async()=>{
    process.env.EVOLUTION_TARGET_RUN_URL="https://runner.internal/run";
    const bytes=Buffer.from([0x25,0x50,0x44,0x46,0,255]);
    const digest=createHash("sha256").update(bytes).digest("hex");
    const candidate={id:"C1",name:"pdf",change:"x",patches:[],artifactSnapshots:[{
      id:"snapshot",sourceArtifactId:"pdf-source",name:"report.pdf",mimeType:"application/pdf",content:"snapshot",contentHash:"snapshot-hash",createdAt:"now",
    }]};
    const testCase={id:"T1",title:"PDF",input:"i",expected:[],tags:[],hidden:false,criterionIds:[],executionMode:"external-runner",evidenceScope:"product-behavior"};
    const file={sourceArtifactId:"pdf-source",snapshotHash:"snapshot-hash",name:"report.pdf",mimeType:"application/pdf",sha256:digest,size:bytes.length,contentBase64:bytes.toString("base64")};
    const input={projectId:"p",connectionId:"c",testCase,variant:candidate,file};
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({testCaseId:"T1",output:"checked",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:digest,trace:[]}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(runHttpTarget({...input,file:{...file,snapshotHash:"old"}})).rejects.toThrow("Snapshot 身份不一致");
    await expect(runHttpTarget({...input,file:{...file,contentBase64:Buffer.from("other").toString("base64")}})).rejects.toThrow("字节与 SHA-256");
    await expect(runHttpTarget({...input,artifact:{name:"other",content:"other"}})).rejects.toThrow("不能与旧 HTML/ZIP");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(runHttpTarget(input)).resolves.toMatchObject({artifactHash:digest,verificationStatus:"verified"});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({testCaseId:"T1",output:"wrong",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:"wrong",trace:[]}),{status:200}));
    await expect(runHttpTarget(input)).rejects.toThrow("submitted Artifact SHA-256");
  });
  it("accepts a zero-byte file only when its empty SHA-256 receipt matches",async()=>{
    process.env.EVOLUTION_TARGET_RUN_URL="https://runner.internal/run";
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://runner.internal/release";
    const emptyHash=createHash("sha256").update(Buffer.alloc(0)).digest("hex");
    const candidate={id:"C1",name:"empty",change:"x",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"empty.bin",mimeType:"application/octet-stream",content:"",contentHash:"snapshot-empty",createdAt:"now"}]};
    const file={sourceArtifactId:"source",snapshotHash:"snapshot-empty",name:"empty.bin",mimeType:"application/octet-stream",sha256:emptyHash,size:0,contentBase64:""};
    const fetchMock=vi.fn(async(url:string|URL|Request)=>new Response(JSON.stringify(String(url).endsWith("/run")
      ?{testCaseId:"T1",output:"empty verified",latencyMs:1,cost:0,verificationStatus:"verified",artifactHash:emptyHash,trace:[]}
      :{ok:true,trafficPercent:0,note:"empty deployed",healthy:true,kpis:[],evidenceMode:"live",artifactByteHashes:[{sourceArtifactId:"source",sha256:emptyHash}]}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(runHttpTarget({projectId:"p",connectionId:"c",variant:candidate,file,
      testCase:{id:"T1",title:"empty",input:"inspect",expected:[],tags:[],hidden:false,criterionIds:[],executionMode:"external-runner",evidenceScope:"product-behavior"}}))
      .resolves.toMatchObject({artifactHash:emptyHash,verificationStatus:"verified"});
    await expect(releaseHttpTarget({projectId:"p",connectionId:"c",candidate,action:"shadow",frozenArtifacts:[file]}))
      .resolves.toMatchObject({artifactByteHashes:[{sourceArtifactId:"source",sha256:emptyHash}]});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("proxies rollback with server-only credentials without resending Candidate bytes",async()=>{
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://runner.internal/release";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="secret-server-token";
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer secret-server-token");
      return new Response(JSON.stringify({
        ok:true,trafficPercent:0,note:"ok",healthy:true,kpis:[],evidenceMode:"live",observationStatus:"healthy",
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const candidate={
      id:"C1",name:"c",change:"x",patches:[],addressesAdvice:[],riskLevel:"low",risks:[],
      accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS",recommended:true,status:"passed",notes:[],artifactSnapshots:[],
    };
    const result=await releaseHttpTarget({projectId:"p",connectionId:"c",candidate,action:"rollback"});
    expect(result.ok).toBe(true);
  });

  it("checks frozen Release bytes before POST and requires the remote byte-hash receipt",async()=>{
    process.env.EVOLUTION_TARGET_RELEASE_URL="https://runner.internal/release";
    const content="exact frozen bytes";
    const digest=createHash("sha256").update(content).digest("hex");
    const candidate={
      id:"C1",name:"accepted",change:"x",patches:[],artifactSnapshots:[{
        id:"snapshot",sourceArtifactId:"source",name:"index.html",mimeType:"text/html",content,
        contentHash:"snapshot-hash",createdAt:"now",
      }],
    };
    const artifact={sourceArtifactId:"source",snapshotHash:"snapshot-hash",name:"index.html",mimeType:"text/html",sha256:digest,size:Buffer.byteLength(content),contentBase64:Buffer.from(content).toString("base64")};
    const input={projectId:"p",connectionId:"c",candidate,action:"shadow",frozenArtifacts:[artifact]};
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({ok:true,trafficPercent:0,note:"ok",healthy:true,kpis:[],evidenceMode:"live",artifactByteHashes:[{sourceArtifactId:"source",sha256:digest}]}),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(releaseHttpTarget({...input,frozenArtifacts:undefined})).rejects.toThrow("缺少 Gate F 冻结文件载荷");
    await expect(releaseHttpTarget({...input,frozenArtifacts:[{...artifact,contentBase64:Buffer.from("wrong frozen bytes").toString("base64")}] })).rejects.toThrow("字节与 SHA-256");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(releaseHttpTarget(input)).resolves.toMatchObject({artifactByteHashes:[{sourceArtifactId:"source",sha256:digest}]});
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ok:true,trafficPercent:0,note:"wrong byte receipt",healthy:true,kpis:[],evidenceMode:"live",artifactByteHashes:[{sourceArtifactId:"source",sha256:"wrong"}]}),{status:200}));
    await expect(releaseHttpTarget(input)).rejects.toThrow("回执未确认 Gate F");
  });
  it("proxies a read-only observe receipt with strict live release identity",async()=>{
    process.env.EVOLUTION_TARGET_OBSERVE_URL="https://runner.internal/observe";
    process.env.EVOLUTION_TARGET_BEARER_TOKEN="secret-server-token";
    const fetchMock=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer secret-server-token");
      const body=JSON.parse(String(init?.body)) as {candidate:{id:string};recoveryAction?:string;expectedArtifactHashes?:unknown[];expectedArtifactByteHashes?:unknown[]};
      expect(body.candidate.id).toBe("C1");
      expect(body.recoveryAction).toBe("promote");
      expect(body.expectedArtifactHashes).toHaveLength(1);
      expect(body.expectedArtifactByteHashes).toEqual([{sourceArtifactId:"source",sha256:"a".repeat(64)}]);
      return new Response(JSON.stringify({
        ok:true,trafficPercent:100,note:"production observed",healthy:true,kpis:[],evidenceMode:"live",
        effectiveAction:"promote",observationStatus:"healthy",deploymentId:"http-candidate",stableDeploymentId:"http-stable",
        artifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
        artifactByteHashes:[{sourceArtifactId:"source",sha256:"a".repeat(64)}],
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
      expectedArtifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],expectedArtifactByteHashes:[{sourceArtifactId:"source",sha256:"a".repeat(64)}],recoveryAction:"promote",healthPath:"/",
    });
    expect(result).toMatchObject({evidenceMode:"live",effectiveAction:"promote",deploymentId:"http-candidate"});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ...result,artifactByteHashes:[{sourceArtifactId:"source",sha256:"b".repeat(64)}],
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    await expect(observeHttpTarget({
      projectId:"p",connectionId:"c",candidate,deploymentId:"http-candidate",stableDeploymentId:"http-stable",
      expectedArtifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
      expectedArtifactByteHashes:[{sourceArtifactId:"source",sha256:"a".repeat(64)}],recoveryAction:"promote",healthPath:"/",
    })).rejects.toThrow("Gate F 字节 SHA-256");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ...result,effectiveAction:"rollback",trafficPercent:0,artifactByteHashes:undefined,
    }),{status:200,headers:{"Content-Type":"application/json"}})));
    await expect(observeHttpTarget({
      projectId:"p",connectionId:"c",candidate,deploymentId:"http-candidate",stableDeploymentId:"http-stable",
      expectedArtifactHashes:[{sourceArtifactId:"source",contentHash:"hash-c1"}],
      expectedArtifactByteHashes:[{sourceArtifactId:"source",sha256:"a".repeat(64)}],recoveryAction:"rollback",healthPath:"/",
    })).resolves.toMatchObject({effectiveAction:"rollback"});
  });

  it("confirms an uncertain rollback without Candidate Gate F hashes but rejects a still-live Candidate",async()=>{
    process.env.EVOLUTION_TARGET_OBSERVE_URL="https://runner.internal/observe";
    const candidate={id:"C1",name:"c",change:"x",patches:[],artifactSnapshots:[{id:"s",sourceArtifactId:"source",name:"a.txt",mimeType:"text/plain",content:"new",contentHash:"hash-c1",createdAt:"now"}]};
    const input={projectId:"p",connectionId:"c",candidate,recoveryAction:"rollback"};
    const rollback={ok:true,trafficPercent:0,note:"stable observed",healthy:true,kpis:[],evidenceMode:"live",effectiveAction:"rollback",observationStatus:"healthy",deploymentId:"stable",stableDeploymentId:"stable",environment:"production",observedAt:"2026-09-27T00:00:00Z"};
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify(rollback),{status:200}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(observeHttpTarget(input)).resolves.toMatchObject({effectiveAction:"rollback",deploymentId:"stable"});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({...rollback,effectiveAction:"promote",deploymentId:"candidate",trafficPercent:100}),{status:200}));
    await expect(observeHttpTarget(input)).rejects.toThrow("Gate F 字节 SHA-256");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(observeHttpTarget({...input,recoveryAction:"promote"})).rejects.toThrow("预期字节 SHA-256");
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
