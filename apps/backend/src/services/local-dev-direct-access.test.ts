// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent,getHeader} from "nitro/h3";
import {localDevDirectAccess,operatorSessionStatus} from "./operator-session";
import {resolveEvolutionActor} from "./security-policy";

vi.mock("nitro/h3",async(importOriginal)=>( {
  ...await importOriginal<typeof import("nitro/h3")>(),
  getRequestIP:(event:Parameters<typeof getHeader>[0])=>getHeader(event,"x-test-remote-ip")??undefined,
}));

const names=["NODE_ENV","EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH","EVOLUTION_IDENTITY_HMAC_SECRET","EVOLUTION_WORKSPACE_ID","EVOLUTION_OPERATOR_ACCESS_KEY"] as const;
const before=new Map<string,string|undefined>();
function request(host:string,method="GET",origin?:string,remoteIp="127.0.0.1"){
  return mockEvent(new Request(`http://${host}/api/evolution/missions`,{
    method,headers:{"x-test-remote-ip":remoteIp,...(origin?{origin}:{})},
  }));
}

beforeEach(()=>{
  for(const name of names){before.set(name,process.env[name]);delete process.env[name];}
  process.env.NODE_ENV="development";
  process.env.EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH="true";
  process.env.EVOLUTION_IDENTITY_HMAC_SECRET="0123456789abcdef0123456789abcdef";
  process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
});
afterEach(()=>{
  for(const name of names){const value=before.get(name);if(value===undefined)delete process.env[name];else process.env[name]=value;}
});

describe("explicit local development direct access",()=>{
  it("opens the local backend without an operator key",()=>{
    const event=request("localhost:8000");
    expect(operatorSessionStatus(event)).toMatchObject({configured:true,authenticated:true,localDirect:true});
    expect(resolveEvolutionActor(event)).toMatchObject({role:"admin",source:"internal-dev",workspaceId:"workspace-test"});
  });

  it("requires loopback destination and peer",()=>{
    expect(localDevDirectAccess(request("192.168.1.73:8000"))).toBe(false);
    expect(localDevDirectAccess(request("localhost:8000","GET",undefined,"192.168.1.73"))).toBe(false);
  });

  it("keeps production protected even if the flag is set",()=>{
    process.env.NODE_ENV="production";
    expect(localDevDirectAccess(request("localhost:8000"))).toBe(false);
    expect(operatorSessionStatus(request("localhost:8000")).authenticated).toBe(false);
  });

  it("requires same-origin for local writes",()=>{
    expect(()=>resolveEvolutionActor(request("localhost:8000","POST","http://evil.test"))).toThrow("same-origin");
    expect(resolveEvolutionActor(request("localhost:8000","POST","http://localhost:8000")).role).toBe("admin");
  });
});