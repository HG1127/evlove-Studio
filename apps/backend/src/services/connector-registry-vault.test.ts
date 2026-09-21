// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const vault=vi.hoisted(()=>({
  getVaultSecretMetadata:vi.fn(),
  resolveVaultSecret:vi.fn(),
}));
vi.mock("./server-vault",()=>vault);

import {
  connectorWebhookSecret,
  executeConnectorAction,
  getConnectorRegistryCapabilities,
} from "./connector-registry";

const previous=process.env.EVOLUTION_CONNECTORS_JSON;

describe("connector registry Vault references",()=>{
  beforeEach(()=>{
    vault.getVaultSecretMetadata.mockReset();
    vault.resolveVaultSecret.mockReset();
    process.env.EVOLUTION_CONNECTORS_JSON=JSON.stringify([{
      id:"vault-connector",
      label:"Vault Connector",
      targetType:"workflow",
      baseUrl:"https://connector.test",
      credentialVaultId:"connector-auth",
      webhookSecretVaultId:"connector-hook",
      paths:{snapshot:"/snapshot"},
    }]);
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    if(previous===undefined)delete process.env.EVOLUTION_CONNECTORS_JSON;
    else process.env.EVOLUTION_CONNECTORS_JSON=previous;
  });

  it("reports Vault-backed credentials as configured only when metadata exists",async()=>{
    vault.getVaultSecretMetadata.mockImplementation(async(id:string)=>id.startsWith("connector-")?{id}:undefined);
    const caps=await getConnectorRegistryCapabilities();
    expect(caps.connectors[0]).toMatchObject({
      credentialConfigured:true,
      webhookConfigured:true,
      credentialProvider:"vault",
      webhookProvider:"vault",
    });
    expect(JSON.stringify(caps)).not.toContain("fixture-credential");
  });

  it("resolves Vault bearer and webhook values only inside server execution",async()=>{
    vault.getVaultSecretMetadata.mockResolvedValue({id:"present"});
    vault.resolveVaultSecret.mockImplementation(async(id:string,scope?:string)=>{
      if(id==="connector-auth"){
        expect(scope).toBe("connector:vault-connector:credential");
        return "fixture-credential";
      }
      expect(scope).toBe("connector:vault-connector:webhook");
      return "fixture-webhook";
    });
    const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toBe("https://connector.test/snapshot");
      expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer fixture-credential");
      return new Response(JSON.stringify({
        ok:true,snapshotRef:"snap-1",evidenceRefs:[],note:"ok",
      }),{status:200,headers:{"Content-Type":"application/json"}});
    });
    vi.stubGlobal("fetch",fetchMock);
    const result=await executeConnectorAction({
      connectorId:"vault-connector",operation:"snapshot",targetId:"target-1",payload:{},
    });
    expect(result.snapshotRef).toBe("snap-1");
    expect(JSON.stringify(result)).not.toContain("fixture-credential");
    await expect(connectorWebhookSecret("vault-connector")).resolves.toBe("fixture-webhook");
  });
});
