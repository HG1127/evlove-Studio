// @vitest-environment node
import {describe,expect,it} from "vitest";
import {getProductionBuildInfo} from "./build-info";

describe("production build info",()=>{
  it("exposes only bounded deployment metadata",()=>{
    const info=getProductionBuildInfo({
      VERCEL_GIT_COMMIT_SHA:"abc123",
      VERCEL_GIT_COMMIT_REF:"main",
      VERCEL_ENV:"production",
      VERCEL_URL:"example-deploy.vercel.app",
      SUPABASE_SERVICE_ROLE_KEY:"must-not-leak",
      EVOLUTION_IDENTITY_HMAC_SECRET:"must-not-leak",
    });
    expect(info).toMatchObject({
      commitSha:"abc123",
      commitRef:"main",
      vercelEnvironment:"production",
      deploymentHost:"example-deploy.vercel.app",
    });
    expect(JSON.stringify(info)).not.toContain("must-not-leak");
  });

  it("omits absent or invalid optional metadata",()=>{
    const info=getProductionBuildInfo({
      VERCEL_ENV:"unexpected",
      VERCEL_GIT_COMMIT_SHA:" ",
    });
    expect(info.commitSha).toBeUndefined();
    expect(info.vercelEnvironment).toBeUndefined();
    expect(info.checkedAt).toMatch(/Z$/);
  });
});
