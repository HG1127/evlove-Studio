import {describe,expect,it} from "vitest";
import {getExplicitSandboxCredentials,getVercelSandboxAuthorizationDiagnostic,sandboxCredentialIssue,sandboxCredentialWindowIssue} from "./vercel-sandbox-credentials";

const NOW=Date.parse("2026-10-20T10:00:00Z");
const jwt=(claims:Record<string,unknown>)=>{
  const header=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT"})).toString("base64url");
  const payload=Buffer.from(JSON.stringify(claims)).toString("base64url");
  return header+"."+payload+".signature-for-test";
};
const future=Math.round(NOW/1000)+9*3600;
const expired=Math.round(NOW/1000)-3600;
const env=(token?:string,extra:Record<string,string>={})=>({
  ...(token?{VERCEL_OIDC_TOKEN:token}:{}),
  ...extra,
});

describe("Vercel Sandbox passive OIDC denial diagnostics",()=>{
  it("detects expired token without exposing its raw bytes or believing a stale JWT is authorized",()=>{
    const token=jwt({exp:expired,project_id:"prj-a",owner_id:"team-a"});
    const result=sandboxCredentialIssue(env(token),NOW);
    expect(result).toMatchObject({code:"VERCEL_OIDC_EXPIRED",
      expiresAt:new Date(expired*1000).toISOString()});
    expect(result?.message).toContain("vercel env pull");
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("rejects tokens too close to expiry for a Sandbox job",()=>{
    const issue=sandboxCredentialIssue(env(jwt({exp:Math.floor(NOW/1000)+119})),NOW);
    expect(issue?.code).toBe("VERCEL_OIDC_EXPIRED");
    expect(sandboxCredentialIssue(env(jwt({exp:Math.floor(NOW/1000)+240})),NOW)).toBeUndefined();
  });
  it("rejects invalid payload and missing expiration without provider calls",()=>{
    expect(sandboxCredentialIssue(env("garbage"),NOW)?.code).toBe("VERCEL_OIDC_INVALID");
    expect(sandboxCredentialIssue(env("a.badpayload.c"),NOW)?.code).toBe("VERCEL_OIDC_INVALID");
    expect(sandboxCredentialIssue(env(jwt({iat:NOW/1000})),NOW)?.code).toBe("VERCEL_OIDC_INVALID");
  });
  it("blocks project and team scope mismatch, while leaving correctly scoped tokens unverified",()=>{
    const token=jwt({exp:future,project_id:"prj-authorized",owner_id:"team-authorized"});
    expect(sandboxCredentialIssue(env(token,{VERCEL_PROJECT_ID:"prj-other"}),NOW)?.code)
      .toBe("VERCEL_PROJECT_SCOPE_MISMATCH");
    expect(sandboxCredentialIssue(env(token,{VERCEL_PROJECT_ID:"prj-authorized",VERCEL_TEAM_ID:"team-other"}),NOW)?.code)
      .toBe("VERCEL_TEAM_SCOPE_MISMATCH");
    expect(sandboxCredentialIssue(env(token,{VERCEL_PROJECT_ID:"prj-authorized",VERCEL_TEAM_ID:"team-authorized"}),NOW))
      .toBeUndefined();
  });
  it("does not mistake missing OIDC on a Vercel deployment for invalid authentication",()=>{
    expect(sandboxCredentialIssue({},NOW)).toBeUndefined();
  });
  it("reports an expired OIDC passively, without returning token bytes or asserting provider readiness",()=>{
    const token=jwt({exp:expired,owner_id:"private-team",project_id:"private-project"});
    const report=getVercelSandboxAuthorizationDiagnostic(env(token),NOW);
    expect(report).toMatchObject({probeMode:"passive-config",state:"expired",
      oidcPresent:true,providerVerified:false,issueCode:"VERCEL_OIDC_EXPIRED"});
    expect(report.nextAction).toContain("vercel env pull");
    expect(JSON.stringify(report)).not.toContain(token);
    expect(JSON.stringify(report)).not.toContain("private-project");
    expect(JSON.stringify(report)).not.toContain("private-team");
  });
  it("does not turn an apparently valid JWT or cloud deployment into authorized Sandbox proof",()=>{
    const valid=getVercelSandboxAuthorizationDiagnostic(env(jwt({exp:future})),NOW);
    expect(valid).toMatchObject({state:"unverified",providerVerified:false,oidcPresent:true});
    const deployment=getVercelSandboxAuthorizationDiagnostic({VERCEL_ENV:"preview"},NOW);
    expect(deployment).toMatchObject({state:"unverified",providerVerified:false,oidcPresent:false});
    const local=getVercelSandboxAuthorizationDiagnostic({},NOW);
    expect(local).toMatchObject({state:"missing-local-oidc",providerVerified:false});
  });
  it("supports explicit scoped Access Token in spite of an expired local OIDC, without treating it as verified",()=>{
    const alternate=env(jwt({exp:expired}),{
      EVOLUTION_SANDBOX_AUTH_MODE:"access-token",
      VERCEL_TOKEN:"safe-dummy-token-for-test",
      VERCEL_TEAM_ID:"team_example",
      VERCEL_PROJECT_ID:"prj_example",
    });
    expect(sandboxCredentialIssue(alternate,NOW)).toBeUndefined();
    expect(getExplicitSandboxCredentials(alternate)).toEqual({
      token:"safe-dummy-token-for-test",teamId:"team_example",projectId:"prj_example",
    });
    const diagnostic=getVercelSandboxAuthorizationDiagnostic(alternate,NOW);
    expect(diagnostic).toMatchObject({state:"access-token-unverified",providerVerified:false});
    expect(JSON.stringify(diagnostic)).not.toContain("safe-dummy-token-for-test");
    expect(JSON.stringify(diagnostic)).not.toContain("team_example");
    expect(JSON.stringify(diagnostic)).not.toContain("prj_example");
    expect(sandboxCredentialIssue(env(jwt({exp:expired}),{
      VERCEL_TOKEN:"safe-dummy-token-for-test",
      VERCEL_TEAM_ID:"team_example",VERCEL_PROJECT_ID:"prj_example",
    }),NOW)?.code).toBe("VERCEL_OIDC_EXPIRED"); // opt-in is mandatory
  });
  it("fails closed on incomplete or inconsistent scoped Access Token parameters",()=>{
    for(const bad of [
      {VERCEL_TOKEN:"safe-but-no-team",VERCEL_PROJECT_ID:"prj_example"},
      {VERCEL_TOKEN:"safe-but-no-project",VERCEL_TEAM_ID:"team_example"},
      {VERCEL_TOKEN:"safe",VERCEL_TEAM_ID:"wrong",VERCEL_PROJECT_ID:"prj_example"},
      {VERCEL_TOKEN:"safe",VERCEL_TEAM_ID:"team_example",VERCEL_PROJECT_ID:"wrong"},
      {VERCEL_TOKEN:"safe",VERCEL_TEAM_ID:"team_a",VERCEL_ORG_ID:"team_b",VERCEL_PROJECT_ID:"prj_example"},
    ]){
      const wrong={EVOLUTION_SANDBOX_AUTH_MODE:"access-token",...bad};
      expect(sandboxCredentialIssue(wrong,NOW)?.code).toBe("VERCEL_ACCESS_TOKEN_INCOMPLETE");
      expect(()=>getExplicitSandboxCredentials(wrong)).toThrow();
      expect(getVercelSandboxAuthorizationDiagnostic(wrong,NOW))
        .toMatchObject({state:"access-token-incomplete",providerVerified:false,
          issueCode:"VERCEL_ACCESS_TOKEN_INCOMPLETE"});
    }
    expect(getExplicitSandboxCredentials({VERCEL_OIDC_TOKEN:jwt({exp:future})})).toBeUndefined();
  });
  it("blocks future-not-before clocks",()=>{
    expect(sandboxCredentialIssue(env(jwt({exp:future,nbf:Math.floor(NOW/1000)+900})),NOW)?.code)
      .toBe("VERCEL_OIDC_NOT_YET_VALID");
  });
  it("rejects the C12 start-time counterexample even while ordinary two-minute diagnostics pass",()=>{
    const at=Date.parse("2026-10-27T12:32:35.815Z"),expiry=Date.parse("2026-10-27T12:37:26.000Z"),token=jwt({exp:expiry/1000});
    expect(sandboxCredentialIssue(env(token),at)).toBeUndefined();
    const issue=sandboxCredentialWindowIssue(1_800_000,env(token),at);
    expect(issue).toMatchObject({code:"VERCEL_OIDC_WINDOW_TOO_SHORT",expiresAt:new Date(expiry).toISOString()});
    expect(JSON.stringify(issue)).not.toContain(token);
  });
  it("requires the full bounded window plus two minutes, retaining the exact expiry boundary",()=>{
    const token=jwt({exp:(NOW+1_920_000)/1000});
    expect(sandboxCredentialWindowIssue(1_800_000,env(token),NOW)?.code).toBe("VERCEL_OIDC_WINDOW_TOO_SHORT");
    expect(sandboxCredentialWindowIssue(1_799_999,env(token),NOW)).toBeUndefined();
    expect(sandboxCredentialWindowIssue(0,env(jwt({exp:expired})),NOW)?.code).toBe("VERCEL_OIDC_EXPIRED");
  });
  it("preserves scope and malformed credential denials before the window check",()=>{
    expect(sandboxCredentialWindowIssue(1_800_000,env("invalid"),NOW)?.code).toBe("VERCEL_OIDC_INVALID");
    expect(sandboxCredentialWindowIssue(1_800_000,env(jwt({exp:future,project_id:"prj_a"}),{VERCEL_PROJECT_ID:"prj_b"}),NOW)?.code).toBe("VERCEL_PROJECT_SCOPE_MISMATCH");
  });
  it("does not infer a deployment refresh or Access Token lifetime from local JWT claims",()=>{
    const token=jwt({exp:(NOW+600_000)/1000});
    expect(sandboxCredentialWindowIssue(1_800_000,env(token,{VERCEL:"1",VERCEL_ENV:"production"}),NOW)).toBeUndefined();
    expect(sandboxCredentialWindowIssue(1_800_000,{VERCEL:"1",VERCEL_ENV:"preview"},NOW)).toBeUndefined();
    expect(sandboxCredentialWindowIssue(1_800_000,env(token,{VERCEL_ENV:"production"}),NOW)?.code).toBe("VERCEL_OIDC_WINDOW_TOO_SHORT");
    expect(sandboxCredentialWindowIssue(1_800_000,env(token,{VERCEL:"1",VERCEL_ENV:"development"}),NOW)?.code).toBe("VERCEL_OIDC_WINDOW_TOO_SHORT");
    expect(sandboxCredentialWindowIssue(1_800_000,env(jwt({exp:expired}),{EVOLUTION_SANDBOX_AUTH_MODE:"access-token",VERCEL_TOKEN:"synthetic",VERCEL_PROJECT_ID:"prj_example",VERCEL_TEAM_ID:"team_example"}),NOW)).toBeUndefined();
    expect(sandboxCredentialWindowIssue(1_800_000,{EVOLUTION_SANDBOX_AUTH_MODE:"access-token"},NOW)?.code).toBe("VERCEL_ACCESS_TOKEN_INCOMPLETE");
  });
  it.each([-1,NaN,Infinity,1.5])("rejects an invalid credential window %s",window=>{
    expect(()=>sandboxCredentialWindowIssue(window,{},NOW)).toThrow("Invalid Sandbox credential window");
  });
});
