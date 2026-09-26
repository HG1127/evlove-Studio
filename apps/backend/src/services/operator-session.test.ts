// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {mockEvent} from "nitro/h3";
import {
  assertOperatorSameOrigin,createOperatorSession,operatorSessionConfigured,
  operatorSessionStatus,verifyOperatorSession,
} from "./operator-session";
import {requireGovernedEvolutionPermission,resolveEvolutionActor} from "./security-policy";
import statusRoute from "../../server/api/evolution/operator-session.get";
import loginRoute from "../../server/api/evolution/operator-session.post";
import logoutRoute from "../../server/api/evolution/operator-session.delete";

const keys=["NODE_ENV","EVOLUTION_IDENTITY_HMAC_SECRET","EVOLUTION_OPERATOR_ACCESS_KEY",
  "EVOLUTION_WORKSPACE_ID","EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH","VERCEL"] as const;
const prior=new Map<string,string|undefined>();
const accessKey="a".repeat(64);

beforeEach(()=>{
  for(const key of keys){prior.set(key,process.env[key]);delete process.env[key];}
  process.env.NODE_ENV="production";
  process.env.EVOLUTION_IDENTITY_HMAC_SECRET="identity-secret-0123456789abcdef0123456789abcdef";
  process.env.EVOLUTION_OPERATOR_ACCESS_KEY=accessKey;
  process.env.EVOLUTION_WORKSPACE_ID="workspace-1";
});
afterEach(()=>{
  for(const key of keys){const value=prior.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

describe("single-operator browser session",()=>{
  it("requires a configured 256-bit access key, identity signer, and workspace",()=>{
    expect(operatorSessionConfigured()).toBe(true);
    expect(createOperatorSession("wrong")).toBeUndefined();
    process.env.EVOLUTION_OPERATOR_ACCESS_KEY="short";
    expect(operatorSessionConfigured()).toBe(false);
    process.env.EVOLUTION_OPERATOR_ACCESS_KEY=accessKey;
    delete process.env.EVOLUTION_WORKSPACE_ID;
    expect(operatorSessionConfigured()).toBe(false);
  });

  it("rejects tampering, expiry, and access-key rotation",()=>{
    const now=1_790_381_000;
    const session=createOperatorSession(accessKey,now)!;
    expect(verifyOperatorSession(session.token,now+1)?.actor).toMatchObject({
      id:"browser-operator",role:"admin",workspaceId:"workspace-1",source:"browser-session",
    });
    expect(verifyOperatorSession(session.token+"x",now+1)).toBeUndefined();
    expect(verifyOperatorSession(session.token,session.expiresAt)).toBeUndefined();
    process.env.EVOLUTION_OPERATOR_ACCESS_KEY="b".repeat(64);
    expect(verifyOperatorSession(session.token,now+1)).toBeUndefined();
  });

  it("accepts a cookie only for same-origin browser mutations",async()=>{
    const token=createOperatorSession(accessKey)!.token;
    const headers={cookie:`evolution_operator_session=${token}`,origin:"https://studio.example.com",
      "sec-fetch-site":"same-origin"};
    const allowed=mockEvent(new Request("https://studio.example.com/api/evolution/jobs",{
      method:"POST",headers,
    }));
    expect(resolveEvolutionActor(allowed).source).toBe("browser-session");
    expect((await requireGovernedEvolutionPermission(allowed,"release.approve")).role).toBe("admin");
    const crossOrigin=mockEvent(new Request("https://studio.example.com/api/evolution/jobs",{
      method:"POST",headers:{...headers,origin:"https://evil.example.com"},
    }));
    expect(()=>resolveEvolutionActor(crossOrigin)).toThrow("same-origin");
    const noOrigin=mockEvent(new Request("https://studio.example.com/api/evolution/jobs",{
      method:"POST",headers:{cookie:headers.cookie},
    }));
    expect(()=>assertOperatorSameOrigin(noOrigin)).toThrow("same-origin");
  });

  it("returns a public status without exposing the secret or token",()=>{
    const token=createOperatorSession(accessKey)!.token;
    const event=mockEvent(new Request("https://studio.example.com/api/evolution/operator-session",{
      headers:{cookie:`evolution_operator_session=${token}`},
    }));
    expect(operatorSessionStatus(event)).toMatchObject({configured:true,authenticated:true});
    expect(JSON.stringify(operatorSessionStatus(event))).not.toContain(accessKey);
    expect(JSON.stringify(operatorSessionStatus(event))).not.toContain(token);
  });

  it("logs in, sets a protected cookie, and clears it on logout",async()=>{
    const request=(method:"GET"|"POST"|"DELETE",body?:unknown)=>mockEvent(new Request(
      "https://studio.example.com/api/evolution/operator-session",{
        method,headers:{origin:"https://studio.example.com","sec-fetch-site":"same-origin",
          ...(body?{"Content-Type":"application/json"}:{})},
        ...(body?{body:JSON.stringify(body)}:{}),
      },
    ));
    expect(await statusRoute(request("GET"))).toMatchObject({configured:true,authenticated:false});
    const denied=request("POST",{accessKey:"wrong"});
    await expect(loginRoute(denied)).rejects.toMatchObject({statusCode:401});
    const login=request("POST",{accessKey});
    expect(await loginRoute(login)).toMatchObject({configured:true,authenticated:true});
    const cookie=login.res.headers.get("set-cookie")??"";
    expect(cookie).toContain("evolution_operator_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    const logout=request("DELETE");
    expect(await logoutRoute(logout)).toMatchObject({authenticated:false});
    expect(logout.res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
