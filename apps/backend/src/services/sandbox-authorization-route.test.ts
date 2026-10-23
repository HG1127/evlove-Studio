// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {SandboxAuthorizationDiagnosticSchema} from "@evolution/contracts";

const mocks=vi.hoisted(()=>({permission:vi.fn(),diagnose:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("@evolution/adapters/sandbox",()=>({
  getVercelSandboxAuthorizationDiagnostic:mocks.diagnose,
}));
import route from "../../server/api/evolution/sandbox-auth-status.get";

beforeEach(()=>{
  mocks.permission.mockReset();
  mocks.diagnose.mockReset();
  mocks.permission.mockResolvedValue(undefined);
});

describe("read-only Sandbox OIDC diagnosis API boundary",()=>{
  it("requires governed read permission and returns only safe, non-provider-verified fields",async()=>{
    const report=SandboxAuthorizationDiagnosticSchema.parse({
      probeMode:"passive-config",checkedAt:"2026-10-20T10:00:00Z",
      state:"expired",oidcPresent:true,providerVerified:false,
      issueCode:"VERCEL_OIDC_EXPIRED",expiresAt:"2026-09-20T12:46:17Z",
      message:"OIDC expired",nextAction:"Renew authorized Vercel OIDC",
    });
    mocks.diagnose.mockReturnValue(report);
    const response=await route(mockEvent(new Request("http://localhost/api/evolution/sandbox-auth-status")));
    expect(response).toEqual(report);
    expect(mocks.permission).toHaveBeenCalledTimes(1);
    expect(mocks.permission.mock.calls[0]?.[1]).toBe("data.read");
    expect(mocks.diagnose).toHaveBeenCalledTimes(1);
    expect(response.providerVerified).toBe(false);
  });
  it("does not query provider or disclose credential bytes on a denial",async()=>{
    const denied=Object.assign(new Error("permission missing"),{statusCode:403});
    mocks.permission.mockRejectedValue(denied);
    await expect(route(mockEvent(new Request("http://localhost/api/evolution/sandbox-auth-status"))))
      .rejects.toMatchObject({statusCode:403});
    expect(mocks.diagnose).not.toHaveBeenCalled();
  });
});
