// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {EvolveProject,SandboxBrowserHealth,SandboxHealth} from "@evolution/contracts";
import {assertServerHtmlBrowserExecutionReady} from "./html-browser-preflight";

const source=(id:string,extension:string,role:"target"|"reference"="target")=>({
  id,role,extension,mimeType:extension==="html"?"text/html":"text/markdown",
  artifactKind:"document",name:id+"."+extension,
});
function mission(targets:Array<ReturnType<typeof source>>,adapter="artifact"){
  return {id:"audit-html",sourceArtifacts:targets,targetConnection:{adapter}} as unknown as EvolveProject;
}
const sandbox=(ready:boolean,codeReady=true)=>({
  ready,message:ready?"Sandbox executable":"Sandbox not authorized",
  policy:{codeReady},
}) as SandboxHealth;
const browser=(overrides:Partial<SandboxBrowserHealth>={})=>({
  ready:true,message:"verified Chromium",snapshotCached:true,
  previewHealthy:true,browserStepsVerified:true,browserStepsExecuted:2,...overrides,
}) as SandboxBrowserHealth;
function probes(s:SandboxHealth=sandbox(true),b:SandboxBrowserHealth=browser()){
  return {credentials:vi.fn<NonNullable<Parameters<typeof assertServerHtmlBrowserExecutionReady>[1]>["credentials"]>().mockReturnValue(undefined),admission:vi.fn(async()=>{}),evidence:vi.fn<(missionId:string)=>Promise<void>>().mockResolvedValue(undefined),sandbox:vi.fn(async()=>s),browser:vi.fn(async()=>b)};
}

describe("HTML Mission execution preflight - actual Browser capability",()=>{
  it("rejects a fixed local credential that cannot cover the Campaign before any database, Sandbox or Browser probes",async()=>{
    const project=mission([source("real-sop","html")]);
    project.campaign={stopCriteria:{maxWallMinutes:30}} as EvolveProject["campaign"];
    const ports=probes();
    ports.credentials.mockReturnValue({code:"VERCEL_OIDC_WINDOW_TOO_SHORT",expiresAt:"2026-10-27T12:37:26.000Z",message:"refresh the linked project credential"});
    await expect(assertServerHtmlBrowserExecutionReady(project,ports)).rejects.toMatchObject({status:503,
      data:{code:"HTML_SANDBOX_NOT_READY",credentialIssue:"VERCEL_OIDC_WINDOW_TOO_SHORT",expiresAt:"2026-10-27T12:37:26.000Z"}});
    expect(ports.credentials).toHaveBeenCalledExactlyOnceWith(1_800_000);
    expect(ports.admission).not.toHaveBeenCalled();expect(ports.evidence).not.toHaveBeenCalled();
    expect(ports.sandbox).not.toHaveBeenCalled();expect(ports.browser).not.toHaveBeenCalled();
  });
  it("keeps actual provider probes mandatory after the credential window check",async()=>{
    const project=mission([source("real-sop","html")]);
    project.campaign={stopCriteria:{maxWallMinutes:30}} as EvolveProject["campaign"];
    const ports=probes();
    await assertServerHtmlBrowserExecutionReady(project,ports);
    expect(ports.credentials).toHaveBeenCalledTimes(2);
    expect(ports.credentials).toHaveBeenNthCalledWith(1,1_800_000);
    expect(ports.credentials).toHaveBeenNthCalledWith(2,1_800_000);
    expect(ports.sandbox).toHaveBeenCalledOnce();expect(ports.browser).toHaveBeenCalledOnce();
  });
  it("rechecks after slow real probes, refusing a credential that no longer covers the task",async()=>{
    const project=mission([source("real-sop","html")]);
    project.campaign={stopCriteria:{maxWallMinutes:30}} as EvolveProject["campaign"];
    const ports=probes();
    ports.credentials.mockReturnValueOnce(undefined).mockReturnValueOnce({code:"VERCEL_OIDC_WINDOW_TOO_SHORT",expiresAt:"2026-10-27T12:37:26.000Z",message:"refresh credential"});
    await expect(assertServerHtmlBrowserExecutionReady(project,ports)).rejects.toMatchObject({status:503,data:{credentialIssue:"VERCEL_OIDC_WINDOW_TOO_SHORT"}});
    expect(ports.sandbox).toHaveBeenCalledOnce();expect(ports.browser).toHaveBeenCalledOnce();expect(ports.credentials).toHaveBeenCalledTimes(2);
  });
  it("stops before metered probes when the real database admission migration is missing",async()=>{
    const ports=probes();
    ports.admission.mockRejectedValueOnce(new Error("HTML_CAMPAIGN_MIGRATION_REQUIRED"));
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("real-sop","html")]),ports)).rejects.toThrow("HTML_CAMPAIGN_MIGRATION_REQUIRED");
    expect(ports.evidence).not.toHaveBeenCalled();
    expect(ports.sandbox).not.toHaveBeenCalled();
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it("stops before metered probes when immutable evidence cannot be registered",async()=>{
    const ports=probes();
    ports.evidence.mockRejectedValueOnce(new Error("ARTIFACT_EVIDENCE_NOT_READY"));
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("real-sop","html")]),ports)).rejects.toThrow("ARTIFACT_EVIDENCE_NOT_READY");
    expect(ports.evidence).toHaveBeenCalledWith("audit-html");
    expect(ports.sandbox).not.toHaveBeenCalled();
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it("does not create or probe a Sandbox for normal Markdown/paste Missions",async()=>{
    const ports=probes();
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("document","md")]),ports)).resolves.toBeUndefined();
    expect(ports.credentials).not.toHaveBeenCalled();
    expect(ports.sandbox).not.toHaveBeenCalled();
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it("requires real Sandbox health, not merely adapter code readiness",async()=>{
    const ports=probes(sandbox(false,true));
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("interactive","html")]),ports))
      .rejects.toMatchObject({status:503,data:{code:"HTML_SANDBOX_NOT_READY"}});
    expect(ports.sandbox).toHaveBeenCalledOnce();
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it("returns actionable expired OIDC remediation without exposing tokens or starting Browser",async()=>{
    const ports=probes({...sandbox(false),message:"VERCEL_OIDC_EXPIRED · token redacted"});
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("index","html")]),ports))
      .rejects.toMatchObject({
        status:503,message:expect.stringContaining("已过期"),
        data:{code:"HTML_SANDBOX_NOT_READY",action:expect.stringContaining("重新拉取 OIDC")},
      });
    expect(ports.sandbox).toHaveBeenCalledOnce();
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it("reports a bounded health timeout without asking to replace valid credentials or starting Browser",async()=>{
    const ports=probes({...sandbox(false),message:"SANDBOX_HEALTH_TIMEOUT · runtime output timed out"});
    const error=await assertServerHtmlBrowserExecutionReady(mission([source("index","html")]),ports).catch((value:unknown)=>value);
    expect(error).toMatchObject({status:503,message:expect.stringContaining("检测超时"),data:{code:"HTML_SANDBOX_NOT_READY",action:expect.stringContaining("原检查")}});
    expect((error as {data:{action:string}}).data.action).not.toMatch(/授权|OIDC|凭据/);
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it("rejects absent Sandbox code capability even if ready was asserted",async()=>{
    const ports=probes(sandbox(true,false));
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("index","htm")]),ports))
      .rejects.toMatchObject({status:503,data:{code:"HTML_SANDBOX_NOT_READY"}});
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it.each([
    {ready:false},
    {previewHealthy:false},
    {browserStepsVerified:false},
    {browserStepsExecuted:0},
  ])("rejects incomplete Browser Runtime evidence: %j",async(override)=>{
    const ports=probes(sandbox(true),browser(override));
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("index","html")]),ports))
      .rejects.toMatchObject({status:503,data:{code:"HTML_BROWSER_NOT_READY"}});
    expect(ports.browser).toHaveBeenCalledOnce();
  });
  it("does not convert transient provider errors into fake browser success",async()=>{
    const ports=probes();
    ports.sandbox.mockRejectedValueOnce(new Error("authentication failure"));
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("index","html")]),ports))
      .rejects.toMatchObject({status:503,data:{code:"HTML_SANDBOX_NOT_READY"}});
    expect(ports.browser).not.toHaveBeenCalled();
    const next=probes();
    next.browser.mockRejectedValueOnce(new Error("chromium snapshot missing"));
    await expect(assertServerHtmlBrowserExecutionReady(mission([source("index","html")]),next))
      .rejects.toMatchObject({status:503,data:{code:"HTML_BROWSER_NOT_READY"}});
  });
  it("rejects legacy HTTP Target Proxy corruption before allocating Sandbox resources",async()=>{
    const ports=probes();
    const legacy=mission([source("index","html")],"http");
    legacy.targetConnection.connectionId="runner-gateway";
    await expect(assertServerHtmlBrowserExecutionReady(legacy,ports))
      .rejects.toMatchObject({status:422,data:{code:"HTML_ARTIFACT_TARGET_BINDING_REQUIRED"}});
    expect(ports.sandbox).not.toHaveBeenCalled();
    expect(ports.browser).not.toHaveBeenCalled();
  });
  it("accepts only actual Sandbox and executable Browser Steps, including HTML with reference materials",async()=>{
    const ports=probes();
    await expect(assertServerHtmlBrowserExecutionReady(mission([
      source("web","html"),source("research","md","reference"),
    ]),ports)).resolves.toBeUndefined();
    expect(ports.sandbox).toHaveBeenCalledOnce();
    expect(ports.browser).toHaveBeenCalledOnce();
  });
  it("preflights Browser execution for HTML within mixed target sets",async()=>{
    const ports=probes();
    await expect(assertServerHtmlBrowserExecutionReady(mission([
      source("index","html"),source("app","md"),
    ]),ports)).resolves.toBeUndefined();
    expect(ports.sandbox).toHaveBeenCalledOnce();
    expect(ports.browser).toHaveBeenCalledOnce();
  });
});
