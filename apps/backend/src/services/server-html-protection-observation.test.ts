// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlProtectionSnapshotRequestSchema } from "@evolution/contracts";
const mocked=vi.hoisted(()=>({observe:vi.fn(),create:vi.fn()}));
vi.mock("@evolution/adapters/sandbox",async original=>({
  ...await original<typeof import("@evolution/adapters/sandbox")>(),
  runVercelSandboxHtmlProtectionCloudObservation:mocked.observe,
  createVercelSandboxHtmlProtectionBrowser:mocked.create,
}));
import { htmlProtectionSnapshotRegistrySha256 } from "@evolution/adapters/sandbox";
import { createServerHtmlProtectionObserver } from "./server-html-protection-observation";
const html=Buffer.from('<p id="actual">synthetic</p>'),sha=createHash("sha256").update(html).digest("hex");
const text="synthetic fixed deployment bundle",runtime={version:"html-protection-private-cloud-v1" as const,text,sha256:createHash("sha256").update(text).digest("hex"),byteLength:Buffer.byteLength(text)};
function args(){
  const registry={schemaVersion:"html-protection-snapshot-registry-v1",projection:"boot-subtree-v1",originalSha256:sha,targets:[{targetId:"root",selector:"#actual"}]};
  const request=HtmlProtectionSnapshotRequestSchema.parse({schemaVersion:"html-protection-snapshot-request-v1",binding:{missionId:"mission",testCaseId:"test",criterionId:"criterion",paperSha256:"a".repeat(64),original:{sourceArtifactId:"source",sha256:sha,byteLength:html.byteLength},executed:{sourceArtifactId:"source",sha256:sha,byteLength:html.byteLength},subject:{kind:"current",versionId:"v1"}},sourceRole:"original",documentUrl:"http://127.0.0.1:4173/index.html",policyVersion:"policy-v1",planSha256:"a".repeat(64),registrySha256:htmlProtectionSnapshotRegistrySha256(registry),registry,execution:{executionId:"execution",jobId:"job",generation:1},stateId:"boot",batchId:"batch"});
  return {request,physicalHtml:Buffer.from(html)};
}
beforeEach(()=>{mocked.observe.mockReset().mockResolvedValue({availability:"unavailable",reason:"synthetic-only"});mocked.create.mockReset();});
describe("trusted application HTML observation composition",()=>{
  it("passes only the fixed validated deployment bytes and the owned SDK factory",async()=>{
    const input=args();await createServerHtmlProtectionObserver({loadOwnedRuntime:async()=>runtime})(input);
    expect(mocked.observe).toHaveBeenCalledExactlyOnceWith(input,{trustedRuntimeBinding:{version:runtime.version,sha256:runtime.sha256,byteLength:runtime.byteLength},trustedRuntimeBytes:Buffer.from(text),createPreparedBrowserSandbox:mocked.create});
    expect(mocked.create).not.toHaveBeenCalled();
  });
  it("owns physical bytes and request before asynchronous runtime loading",async()=>{
    const input=args(),initial=args();
    await createServerHtmlProtectionObserver({loadOwnedRuntime:async()=>{input.physicalHtml.fill(0);input.request.execution.executionId="changed";return runtime;}})(input);
    expect(mocked.observe.mock.calls[0]?.[0]).toEqual(initial);
  });
  it.each([undefined,{...runtime,env:{TOKEN:"must-not-enter-vm"}},{...runtime,text:"x".repeat(4*1024*1024+1)},{...runtime,sha256:"bad"},{...runtime,version:"wrong"}])("keeps invalid deployment configuration unavailable before creating a VM",async value=>{
    await createServerHtmlProtectionObserver({loadOwnedRuntime:async()=>value as typeof runtime})(args());
    expect(mocked.observe.mock.calls[0]).toHaveLength(1);expect(mocked.create).not.toHaveBeenCalled();
  });
  it("keeps a missing generated runtime unavailable and never falls back to user supplied code",async()=>{
    await createServerHtmlProtectionObserver({loadOwnedRuntime:async()=>{throw Error("not built");}})(args());
    expect(mocked.observe.mock.calls[0]).toHaveLength(1);expect(mocked.create).not.toHaveBeenCalled();
  });
  it("rejects malformed external request fields before loading a bundle",async()=>{
    const input=args(),load=vi.fn().mockResolvedValue(runtime);
    await expect(createServerHtmlProtectionObserver({loadOwnedRuntime:load})({...input,request:{...input.request,script:"untrusted"} as typeof input.request})).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();expect(mocked.observe).not.toHaveBeenCalled();
  });
});
