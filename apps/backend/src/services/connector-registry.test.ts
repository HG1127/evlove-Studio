// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {
  executeConnectorAction,
  getConnectorRegistryCapabilities,
  getServerConnectorManifests,
} from "./connector-registry";

const KEYS=["NODE_ENV","EVOLUTION_CONNECTORS_JSON","TEST_CONNECTOR_TOKEN","TEST_CONNECTOR_WEBHOOK"] as const;
const previous=new Map<string,string|undefined>();

function manifest(paths:Record<string,string>={snapshot:"/snapshot"}){
  return JSON.stringify([{
    id:"test-connector",label:"Test Connector",targetType:"workflow",
    baseUrl:"https://connector.test",credentialEnv:"TEST_CONNECTOR_TOKEN",
    webhookSecretEnv:"TEST_CONNECTOR_WEBHOOK",paths,
  }]);
}

describe("connector registry",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){const value=previous.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  });

  it("reports an empty registry without inventing connector support",()=>{
    expect(getConnectorRegistryCapabilities()).toMatchObject({codeReady:true,configured:false,connectorCount:0,fullLifecycleCount:0});
  });

  it("returns sanitized capabilities without exposing credential values",()=>{
    process.env.EVOLUTION_CONNECTORS_JSON=manifest({
      read:"/read",snapshot:"/snapshot",mutate:"/mutate",validate:"/validate",
      deploy:"/deploy",observe:"/observe",rollback:"/rollback",
    });
    process.env.TEST_CONNECTOR_TOKEN="super-secret-token";
    process.env.TEST_CONNECTOR_WEBHOOK="webhook-secret";
    const caps=getConnectorRegistryCapabilities();
    expect(caps).toMatchObject({configured:true,connectorCount:1,fullLifecycleCount:1});
    expect(caps.connectors[0]).toMatchObject({
      id:"test-connector",targetType:"workflow",credentialConfigured:true,webhookConfigured:true,
      lifecycle:{read:true,snapshot:true,mutate:true,validate:true,deploy:true,observe:true,rollback:true},
    });
    expect(JSON.stringify(caps)).not.toContain("super-secret-token");
    expect(JSON.stringify(caps)).not.toContain("webhook-secret");
  });

  it("blocks unknown connectors before any network request",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeConnectorAction({
      connectorId:"missing",operation:"snapshot",targetId:"target-1",payload:{},
    })).rejects.toMatchObject({code:"CONNECTOR_NOT_REGISTERED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks lifecycle operations not declared by the server manifest",async()=>{
    process.env.EVOLUTION_CONNECTORS_JSON=manifest({snapshot:"/snapshot"});
    process.env.TEST_CONNECTOR_TOKEN="token";
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    await expect(executeConnectorAction({
      connectorId:"test-connector",operation:"rollback",targetId:"target-1",payload:{},
    })).rejects.toMatchObject({code:"CONNECTOR_OPERATION_UNSUPPORTED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls only the allowlisted endpoint and keeps credentials server-side",async()=>{
    process.env.EVOLUTION_CONNECTORS_JSON=manifest({snapshot:"/snapshot"});
    process.env.TEST_CONNECTOR_TOKEN="connector-token";
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://connector.test/snapshot");
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer connector-token");
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(body).toMatchObject({missionId:"mission-1",targetId:"target-1",expectedVersionRef:"v1"});
      return new Response(JSON.stringify({
        ok:true,versionRef:"v1",snapshotRef:"snap-1",evidenceRefs:["evidence-1"],note:"snapshot",
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeConnectorAction({
      connectorId:"test-connector",operation:"snapshot",missionId:"mission-1",
      targetId:"target-1",expectedVersionRef:"v1",payload:{},
    });
    expect(result).toMatchObject({
      connectorId:"test-connector",operation:"snapshot",targetId:"target-1",snapshotRef:"snap-1",ok:true,
    });
    expect(JSON.stringify(result)).not.toContain("connector-token");
  });

  it("rejects insecure connector origins in production",()=>{
    process.env.NODE_ENV="production";
    process.env.EVOLUTION_CONNECTORS_JSON=JSON.stringify([{
      id:"unsafe",label:"Unsafe",targetType:"api",baseUrl:"http://127.0.0.1:9999",paths:{read:"/read"},
    }]);
    expect(()=>getServerConnectorManifests()).toThrow(/HTTPS|localhost/i);
  });
});
